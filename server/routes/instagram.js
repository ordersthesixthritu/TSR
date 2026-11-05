import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

const GRAPH_API = 'https://graph.instagram.com';
const GRAPH_VERSION = 'v21.0';

let feedCache = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getInstagramSettings() {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'instagram'").get();
    if (row) return JSON.parse(row.value);
  } catch { /* no settings yet */ }
  return { enabled: false, post_count: 6, last_sync: null, last_sync_ok: true, cached_feed: null };
}

async function saveInstagramSettings(settings) {
  await db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('instagram', ?, NOW()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(JSON.stringify(settings));
}

async function fetchInstagramFeed(postCount) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!token || !userId) return null;

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url = `${GRAPH_API}/${GRAPH_VERSION}/${userId}/media?fields=${fields}&limit=${postCount}&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Instagram API error: ${res.status}`);
  }
  const json = await res.json();
  return (json.data || []).map(post => ({
    id: post.id,
    caption: (post.caption || '').slice(0, 200),
    type: post.media_type,
    url: post.media_type === 'VIDEO' ? (post.thumbnail_url || post.media_url) : post.media_url,
    videoUrl: post.media_type === 'VIDEO' ? post.media_url : null,
    permalink: post.permalink,
    timestamp: post.timestamp,
  }));
}

// Public: get Instagram feed
router.get('/feed', async (_req, res) => {
  try {
    const settings = await getInstagramSettings();
    if (!settings.enabled) return res.json({ enabled: false, posts: [] });

    const now = Date.now();
    if (feedCache.data && (now - feedCache.ts) < CACHE_TTL) {
      return res.json({ enabled: true, posts: feedCache.data });
    }

    try {
      const posts = await fetchInstagramFeed(settings.post_count || 6);
      if (posts) {
        feedCache = { data: posts, ts: now };
        settings.cached_feed = posts;
        settings.last_sync = new Date().toISOString();
        settings.last_sync_ok = true;
        await saveInstagramSettings(settings);
        return res.json({ enabled: true, posts });
      }
    } catch (err) {
      console.error('Instagram fetch error:', err.message);
      settings.last_sync_ok = false;
      await saveInstagramSettings(settings);
    }

    if (settings.cached_feed && settings.cached_feed.length > 0) {
      feedCache = { data: settings.cached_feed, ts: now - CACHE_TTL + 5 * 60 * 1000 };
      return res.json({ enabled: true, posts: settings.cached_feed });
    }

    res.json({ enabled: true, posts: [] });
  } catch (err) {
    console.error('Instagram feed error:', err.message);
    res.json({ enabled: false, posts: [] });
  }
});

// Admin: get Instagram settings + connection status
router.get('/settings', authenticate, async (_req, res) => {
  try {
    const settings = await getInstagramSettings();
    const hasToken = !!process.env.INSTAGRAM_ACCESS_TOKEN;
    const hasUserId = !!process.env.INSTAGRAM_USER_ID;
    res.json({
      enabled: settings.enabled,
      post_count: settings.post_count || 6,
      last_sync: settings.last_sync,
      last_sync_ok: settings.last_sync_ok !== false,
      connected: hasToken && hasUserId,
      has_token: hasToken,
      has_user_id: hasUserId,
      cached_posts: settings.cached_feed ? settings.cached_feed.length : 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch Instagram settings' });
  }
});

// Admin: update Instagram settings
router.put('/settings', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const settings = await getInstagramSettings();
    if (req.body.enabled !== undefined) settings.enabled = !!req.body.enabled;
    if (req.body.post_count !== undefined) {
      settings.post_count = Math.max(1, Math.min(12, parseInt(req.body.post_count) || 6));
    }
    await saveInstagramSettings(settings);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update Instagram settings' });
  }
});

// Admin: manually refresh feed
router.post('/refresh', authenticate, requireRole('super_admin', 'admin'), async (_req, res) => {
  try {
    const settings = await getInstagramSettings();
    const posts = await fetchInstagramFeed(settings.post_count || 6);
    if (posts) {
      feedCache = { data: posts, ts: Date.now() };
      settings.cached_feed = posts;
      settings.last_sync = new Date().toISOString();
      settings.last_sync_ok = true;
      await saveInstagramSettings(settings);
      return res.json({ ok: true, count: posts.length });
    }
    res.status(400).json({ error: 'No posts returned. Check INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in Vercel environment variables.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: refresh the long-lived token (should be called before 60-day expiry)
router.post('/refresh-token', authenticate, requireRole('super_admin'), async (_req, res) => {
  try {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: 'INSTAGRAM_ACCESS_TOKEN not set' });

    const url = `${GRAPH_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(400).json({ error: err.error?.message || 'Token refresh failed' });
    }
    const data = await r.json();
    res.json({
      ok: true,
      message: 'Token refreshed successfully. Update INSTAGRAM_ACCESS_TOKEN in Vercel with the new value.',
      new_token: data.access_token,
      expires_in_days: Math.floor((data.expires_in || 0) / 86400),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cron: auto-refresh token (called by Vercel cron)
router.get('/cron/refresh-token', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) return res.json({ skipped: true, reason: 'No token configured' });

    const url = `${GRAPH_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.json({ ok: false, error: err.error?.message || 'Refresh failed' });
    }
    const data = await r.json();
    res.json({
      ok: true,
      expires_in_days: Math.floor((data.expires_in || 0) / 86400),
      note: 'Token refreshed. If using Vercel, update the env var with the new token.',
      new_token_preview: data.access_token ? data.access_token.slice(0, 10) + '...' : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
