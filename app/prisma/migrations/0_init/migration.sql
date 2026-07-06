-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SendingDomainStatus" AS ENUM ('UNCONFIGURED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FLAT', 'TIERED');

-- CreateEnum
CREATE TYPE "AmbassadorStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('COMMISSION_EARNED', 'COMMISSION_REVERSED', 'CREDIT_ISSUED', 'CREDIT_REDEEMED', 'CREDIT_EXPIRED', 'PAYOUT');

-- CreateEnum
CREATE TYPE "AttributionMethod" AS ENUM ('CODE', 'LINK', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "DiscountSyncStatus" AS ENUM ('DRAFT', 'QUEUED', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailTrigger" AS ENUM ('MANUAL', 'CREDIT_ISSUED', 'CREDIT_EXPIRING', 'INACTIVITY_30D', 'NEW_PRODUCT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPENED', 'CLICKED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GdprRequestType" AS ENUM ('CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT', 'SHOP_REDACT');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "shop_slug" TEXT NOT NULL,
    "encrypted_access_token" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sending_domain" TEXT,
    "sending_domain_status" "SendingDomainStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default program',
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "percent_bps" INTEGER DEFAULT 1000,
    "flat_cents" INTEGER,
    "tiers" JSONB,
    "cookie_window_days" INTEGER NOT NULL DEFAULT 30,
    "auto_approve_ambassadors" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve_referrals" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambassadors" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "AmbassadorStatus" NOT NULL DEFAULT 'PENDING',
    "tier" TEXT NOT NULL DEFAULT 'default',
    "shopify_customer_id" TEXT,
    "referral_slug" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suppressed_at" TIMESTAMP(3),
    "suppressed_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ambassadors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "ambassador_id" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "order_id" TEXT,
    "referral_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "memo" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "ambassador_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_name" TEXT,
    "attribution_method" "AttributionMethod" NOT NULL,
    "matched_value" TEXT,
    "order_subtotal_cents" INTEGER NOT NULL,
    "order_total_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_configs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "ambassador_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "usage_limit" INTEGER,
    "expires_at" TIMESTAMP(3),
    "restrict_to_new_customers" BOOLEAN NOT NULL DEFAULT false,
    "sync_status" "DiscountSyncStatus" NOT NULL DEFAULT 'DRAFT',
    "shopify_discount_id" TEXT,
    "last_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "trigger" "EmailTrigger" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" JSONB NOT NULL DEFAULT '{}',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "total_queued" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "template_id" TEXT,
    "ambassador_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "rendered_body" TEXT NOT NULL,
    "status" "EmailSendStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "EmailTrigger" NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letters" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "msg_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdpr_requests" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" "GdprRequestType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdpr_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cache" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "image_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_quotas" (
    "merchant_id" TEXT NOT NULL,
    "daily_cap" INTEGER NOT NULL DEFAULT 200,
    "sent_today" INTEGER NOT NULL DEFAULT 0,
    "warmup_started_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "send_quotas_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateIndex
CREATE INDEX "sessions_shop_idx" ON "sessions"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_shop_domain_key" ON "merchants"("shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_shop_slug_key" ON "merchants"("shop_slug");

-- CreateIndex
CREATE INDEX "programs_merchant_id_is_default_idx" ON "programs"("merchant_id", "is_default");

-- CreateIndex
CREATE INDEX "ambassadors_merchant_id_status_idx" ON "ambassadors"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "ambassadors_merchant_id_shopify_customer_id_idx" ON "ambassadors"("merchant_id", "shopify_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "ambassadors_merchant_id_email_key" ON "ambassadors"("merchant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ambassadors_merchant_id_referral_slug_key" ON "ambassadors"("merchant_id", "referral_slug");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_ambassador_id_type_idx" ON "ledger_entries"("ambassador_id", "type");

-- CreateIndex
CREATE INDEX "ledger_entries_merchant_id_type_created_at_idx" ON "ledger_entries"("merchant_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "referrals_ambassador_id_status_idx" ON "referrals"("ambassador_id", "status");

-- CreateIndex
CREATE INDEX "referrals_merchant_id_created_at_idx" ON "referrals"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_merchant_id_order_id_key" ON "referrals"("merchant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_configs_ambassador_id_key" ON "discount_configs"("ambassador_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_configs_merchant_id_code_key" ON "discount_configs"("merchant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "email_sends_idempotency_key_key" ON "email_sends"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_sends_campaign_id_status_idx" ON "email_sends"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "email_sends_provider_message_id_idx" ON "email_sends"("provider_message_id");

-- CreateIndex
CREATE INDEX "webhook_events_shop_topic_idx" ON "webhook_events"("shop", "topic");

-- CreateIndex
CREATE INDEX "dead_letters_queue_created_at_idx" ON "dead_letters"("queue", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_cache_merchant_id_handle_key" ON "product_cache"("merchant_id", "handle");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ambassador_id_fkey" FOREIGN KEY ("ambassador_id") REFERENCES "ambassadors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_ambassador_id_fkey" FOREIGN KEY ("ambassador_id") REFERENCES "ambassadors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_configs" ADD CONSTRAINT "discount_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_configs" ADD CONSTRAINT "discount_configs_ambassador_id_fkey" FOREIGN KEY ("ambassador_id") REFERENCES "ambassadors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "email_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_ambassador_id_fkey" FOREIGN KEY ("ambassador_id") REFERENCES "ambassadors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cache" ADD CONSTRAINT "product_cache_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_quotas" ADD CONSTRAINT "send_quotas_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

