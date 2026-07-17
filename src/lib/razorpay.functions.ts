import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "./plans";

const CreateOrderInput = z.object({
  plan: z.enum(["pro", "max"]),
});

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateOrderInput.parse(i))
  .handler(async ({ data, context }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Payments are not configured.");

    const info = PLAN_LIMITS[data.plan as Plan];
    const amount = info.priceInPaise;
    if (amount < 100) throw new Error("Invalid amount");

    const receipt = `u_${context.userId.slice(0, 8)}_${Date.now().toString(36)}`.slice(0, 40);

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        notes: { user_id: context.userId, plan: data.plan },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 401) throw new Error("Razorpay auth failed.");
      throw new Error(`Razorpay error: ${resp.status} ${errText.slice(0, 200)}`);
    }
    const order = (await resp.json()) as { id: string; amount: number; currency: string };

    await context.supabase.from("payments").insert({
      user_id: context.userId,
      razorpay_order_id: order.id,
      plan: data.plan,
      amount_paise: amount,
      currency: "INR",
      status: "created",
    });

    return {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId,
      plan: data.plan,
    };
  });

const VerifyInput = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VerifyInput.parse(i))
  .handler(async ({ data, context }) => {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new Error("Payments are not configured.");

    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", keySecret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(data.razorpay_signature);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      await context.supabase
        .from("payments")
        .update({ status: "signature_failed", razorpay_payment_id: data.razorpay_payment_id, updated_at: new Date().toISOString() })
        .eq("razorpay_order_id", data.razorpay_order_id)
        .eq("user_id", context.userId);
      throw new Error("Invalid payment signature");
    }

    // Load the order row to determine plan (trust server state, not client)
    const { data: paymentRow } = await context.supabase
      .from("payments")
      .select("plan, status")
      .eq("razorpay_order_id", data.razorpay_order_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!paymentRow) throw new Error("Order not found");

    const plan = paymentRow.plan as Plan;

    await context.supabase
      .from("payments")
      .update({
        status: "paid",
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_signature: data.razorpay_signature,
        updated_at: new Date().toISOString(),
      })
      .eq("razorpay_order_id", data.razorpay_order_id)
      .eq("user_id", context.userId);

    // Upgrade user's plan
    await context.supabase
      .from("profiles")
      .update({ plan })
      .eq("id", context.userId);

    return { ok: true, plan };
  });
