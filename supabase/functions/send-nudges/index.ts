// send-nudges — invoked every minute by pg_cron.
// Sends a web push to every active nudge session whose next_at has passed,
// advances next_at, and cleans up expired sessions / dead subscriptions.
//
// Deploy:  supabase functions deploy send-nudges --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@x.com), CRON_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const now = new Date()

  // Drop sessions that have ended
  await supabase.from('nudge_push_sessions')
    .delete()
    .not('ends_at', 'is', null)
    .lte('ends_at', now.toISOString())

  // Sessions due for a nudge
  const { data: due, error } = await supabase
    .from('nudge_push_sessions')
    .select('*')
    .lte('next_at', now.toISOString())

  if (error) return new Response(error.message, { status: 500 })

  let sent = 0
  for (const s of due ?? []) {
    try {
      await webpush.sendNotification(
        s.subscription,
        JSON.stringify({ title: 'E1 Move', body: s.cue }),
        { TTL: 120, urgency: 'high' },
      )
      sent++
    } catch (e) {
      // 404/410 = subscription is gone (app uninstalled, permission revoked)
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) {
        await supabase.from('nudge_push_sessions').delete().eq('id', s.id)
        continue
      }
      console.error(`push failed for ${s.id}:`, e)
    }

    // Advance next_at past now (skips missed slots if cron was delayed)
    let next = new Date(s.next_at)
    const step = Number(s.interval_mins) * 60000
    while (next <= now) next = new Date(next.getTime() + step)
    await supabase.from('nudge_push_sessions')
      .update({ next_at: next.toISOString() })
      .eq('id', s.id)
  }

  return new Response(JSON.stringify({ due: due?.length ?? 0, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
