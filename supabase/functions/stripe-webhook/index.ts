import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SB_URL')!, Deno.env.get('SB_SERVICE_ROLE_KEY')!)

const PLAN_MAP: Record<string, { plan: string; billing: string }> = {
  'price_1TdKPfBDnma0BBQnRGICVOAh': { plan: 'starter', billing: 'monthly' },
  'price_1TdLOVBDnma0BBQnjaquQy7A': { plan: 'starter', billing: 'yearly'  },
  'price_1TdKe3BDnma0BBQnsuIGuEmO': { plan: 'pro',     billing: 'monthly' },
  'price_1TdLPcBDnma0BBQnNj4e0eA8': { plan: 'pro',     billing: 'yearly'  },
  'price_1TdKfYBDnma0BBQnqqpJODT6': { plan: 'elite',   billing: 'monthly' },
  'price_1TdLNgBDnma0BBQnOxCHllEi': { plan: 'elite',   billing: 'yearly'  },
}

serve(async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const email = session.customer_email || session.customer_details?.email || ''
    if (!email) return new Response('Missing email', { status: 400 })
    const sub = await stripe.subscriptions.retrieve(session.subscription as string)
    const planInfo = PLAN_MAP[sub.items.data[0].price.id] ?? { plan: 'starter', billing: 'monthly' }
    await supabase.from('profiles').update({
      plan: planInfo.plan, billing_cycle: planInfo.billing,
      subscription_status: 'active', stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
    }).eq('email', email)
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const planInfo = PLAN_MAP[sub.items.data[0].price.id] ?? { plan: 'starter', billing: 'monthly' }
    await supabase.from('profiles').update({
      plan: planInfo.plan, billing_cycle: planInfo.billing, subscription_status: sub.status,
    }).eq('stripe_subscription_id', sub.id)
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    await supabase.from('profiles').update({ plan: 'none', subscription_status: 'cancelled' }).eq('stripe_subscription_id', sub.id)
  }

  return new Response('ok', { status: 200 })
})
