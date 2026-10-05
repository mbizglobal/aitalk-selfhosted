
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentAccessMode" AS ENUM ('public', 'team');

-- CreateEnum
CREATE TYPE "AgentMemberAuthMethod" AS ENUM ('password', 'oauth', 'magic_link');

-- CreateEnum
CREATE TYPE "AgentMemberStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AgentMemberInvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "AnonymizationStatus" AS ENUM ('pending', 'scheduled', 'processing', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free', 'starter', 'standard', 'growth', 'pro');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'cancelled', 'past_due', 'incomplete', 'paused', 'pending_payment');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'quarterly');

-- CreateEnum
CREATE TYPE "ServiceVariant" AS ENUM ('self', 'managed');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('company', 'individual');

-- CreateEnum
CREATE TYPE "PaymentPlatform" AS ENUM ('manual_invoice');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('credit_card', 'invoice');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('initial', 'renewal', 'upgrade', 'downgrade');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SUBSCRIPTION_START', 'SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_UPGRADE', 'SUBSCRIPTION_UPGRADE_ROLLBACK', 'SUBSCRIPTION_DOWNGRADE', 'SUBSCRIPTION_CANCEL', 'SUBSCRIPTION_RESUME', 'SUBSCRIPTION_END', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'REFUND', 'CPA_USAGE', 'CPA_BONUS', 'CPA_RESET', 'PLAN_CHANGE', 'SUBSCRIPTION_GRACE_EXPIRED', 'SUBSCRIPTION_HARD_FREE', 'BOOSTER_PURCHASE');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('pending', 'applied', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowTempStorageStatus" AS ENUM ('pending', 'waiting', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowConnectionProvider" AS ENUM ('notion', 'slack', 'github', 'google', 'sendgrid', 'telegram', 'telegram_mcp', 'telegram_webhook', 'imap', 'smtp', 'http_request', 'acs_call', 'clawops_call', 'acs_sms', 'infobip_sms', 'google_workspace', 'microsoft_workspace', 'custom');

-- CreateEnum
CREATE TYPE "WorkflowConnectionTransport" AS ENUM ('streamable_http', 'sse', 'stdio', 'rest_api');

-- CreateEnum
CREATE TYPE "WorkflowConnectionAuthType" AS ENUM ('none', 'bearer', 'oauth', 'api_key', 'custom_header');

-- CreateEnum
CREATE TYPE "WorkflowConnectionStatus" AS ENUM ('active', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "WorkflowCalendarAccountStatus" AS ENUM ('active', 'expired', 'removed');

-- CreateEnum
CREATE TYPE "WorkflowTemplateComplexity" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "WorkflowAiAssistantMessageRole" AS ENUM ('system', 'user', 'assistant');

-- CreateEnum
CREATE TYPE "BotChannelPlatform" AS ENUM ('telegram', 'whatsapp', 'slack', 'discord', 'facebook_messenger', 'pstn');

-- CreateEnum
CREATE TYPE "BotChannelStatus" AS ENUM ('active', 'inactive', 'pending_verification', 'error');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "CallSessionStatus" AS ENUM ('ringing', 'connected', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PartnerContractStatus" AS ENUM ('prospect', 'pending', 'active', 'suspended', 'terminated');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "email_change_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "old_email" TEXT NOT NULL,
    "new_email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "credential_id" VARCHAR(500) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" VARCHAR(200),
    "device_type" VARCHAR(50),
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "name" VARCHAR(100),
    "kind" VARCHAR(20) NOT NULL DEFAULT 'passkey',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_resend_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "attemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_resend_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zki" (
    "id" SERIAL NOT NULL,
    "master_key" VARCHAR(64) NOT NULL,
    "memo" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zki_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" VARCHAR(25) NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "last_login_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "encryptedDataKey" BYTEA,
    "zki_id" INTEGER,
    "is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "anonymized_at" TIMESTAMP(3),
    "signup_fingerprint" TEXT,
    "signup_ip" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_access_token" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_prefix" VARCHAR(16) NOT NULL,
    "scopes" VARCHAR(50) NOT NULL DEFAULT 'read',
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" VARCHAR(45),
    "last_used_country" VARCHAR(2),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_audit_log" (
    "id" VARCHAR(25) NOT NULL,
    "token_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "tool" VARCHAR(60) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "code" VARCHAR(60),
    "workflow_id" VARCHAR(25),
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_rate_bucket" (
    "id" SERIAL NOT NULL,
    "token_id" VARCHAR(25) NOT NULL,
    "class" VARCHAR(10) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mcp_rate_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_deploy_request" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "token_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "target_version" INTEGER NOT NULL,
    "target_json_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "approved_by_id" VARCHAR(25),
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_deploy_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_refresh_token" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25),
    "agent_member_id" INTEGER,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" VARCHAR(25) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "time_format" VARCHAR(50) NOT NULL DEFAULT 'MM-DD-YYYY HH:mm',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'free',
    "api_key_configured" BOOLEAN NOT NULL DEFAULT false,
    "vault_enabled" BOOLEAN NOT NULL DEFAULT false,
    "vault_url" VARCHAR(500),
    "vault_auth_token" TEXT,
    "onboarding_completed_at" TIMESTAMP(3),
    "onboarding_profile" JSONB,
    "account_type" "AccountType",

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_config" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "measurement_id" VARCHAR(20) NOT NULL,
    "api_secret" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" VARCHAR(25) NOT NULL,
    "providers" TEXT,
    "default_provider" VARCHAR(50) NOT NULL DEFAULT 'openai',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_providers" (
    "id" VARCHAR(25) NOT NULL,
    "providers" TEXT,
    "default_provider" VARCHAR(50) NOT NULL DEFAULT 'openai_vector_store',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_stores" (
    "id" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "metadata" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" VARCHAR(25) NOT NULL,
    "plan_type" "SubscriptionPlan" NOT NULL DEFAULT 'free',
    "billing_cycle" "BillingCycle",
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "platform" "PaymentPlatform",
    "payment_method" "PaymentMethod",
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3) NOT NULL,
    "free_cpa" INTEGER NOT NULL DEFAULT 50,
    "free_total" INTEGER NOT NULL DEFAULT 50,
    "paid_cpa" INTEGER NOT NULL DEFAULT 0,
    "paid_total" INTEGER NOT NULL DEFAULT 0,
    "month" INTEGER NOT NULL DEFAULT 1,
    "partner_program_id" VARCHAR(25),
    "trial_ends_at" TIMESTAMP(3),
    "trial_ended_notified_at" TIMESTAMP(3),
    "trial_delete_warned_at" TIMESTAMP(3),
    "signup_source" VARCHAR(20),
    "signup_platform" VARCHAR(10),
    "partner_id" VARCHAR(25),
    "num_assistant" INTEGER NOT NULL DEFAULT 1,
    "service_variant" "ServiceVariant" NOT NULL DEFAULT 'self',
    "managed_region" VARCHAR(30),
    "storage_per_agent" INTEGER,
    "cpa_reset_date" TIMESTAMP(3),
    "doc_pages_per_month" INTEGER,
    "doc_pages_used" INTEGER NOT NULL DEFAULT 0,
    "doc_pages_month" INTEGER NOT NULL DEFAULT 1,
    "grace_started_at" TIMESTAMP(3),
    "grace_alert_sent_at" TIMESTAMP(3),
    "soft_free_converted_at" TIMESTAMP(3),
    "booster_cpa" INTEGER NOT NULL DEFAULT 0,
    "booster_total" INTEGER NOT NULL DEFAULT 0,
    "booster_expires_at" TIMESTAMP(3),
    "booster_expiry_alert_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booster_purchases" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "pack_code" VARCHAR(20) NOT NULL,
    "cpa_amount" INTEGER NOT NULL,
    "price_paid" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "expired_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),

    CONSTRAINT "booster_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managed_region_config" (
    "id" SERIAL NOT NULL,
    "region_id" VARCHAR(30) NOT NULL,
    "openai_api_key" TEXT NOT NULL,
    "openai_endpoint" VARCHAR(200) NOT NULL,
    "search_api_key" TEXT,
    "search_endpoint" VARCHAR(200),
    "doc_intelligence_key" TEXT,
    "doc_intelligence_endpoint" VARCHAR(200),
    "speech_api_key" TEXT,
    "speech_endpoint" VARCHAR(200),
    "speech_region" VARCHAR(50),
    "speech_hd_api_key" TEXT,
    "speech_hd_endpoint" VARCHAR(200),
    "speech_hd_region" VARCHAR(50),
    "realtime_api_key" TEXT,
    "realtime_endpoint" VARCHAR(200),
    "realtime_deployment" VARCHAR(100),
    "realtime_api_version" VARCHAR(50),
    "realtime_deployments" TEXT,
    "blob_connection_string" TEXT,
    "blob_container_name" VARCHAR(100),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_region_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_info" (
    "id" VARCHAR(25) NOT NULL,
    "company_name" VARCHAR(200),
    "vat_number" VARCHAR(50),
    "registration_number" VARCHAR(50),
    "company_address" TEXT,
    "company_city" VARCHAR(100),
    "company_state" VARCHAR(100),
    "company_zip_code" VARCHAR(20),
    "company_country" VARCHAR(100),
    "use_different_invoice_address" BOOLEAN NOT NULL DEFAULT false,
    "invoice_address" TEXT,
    "invoice_city" VARCHAR(100),
    "invoice_state" VARCHAR(100),
    "invoice_zip_code" VARCHAR(20),
    "invoice_country" VARCHAR(100),
    "contact_person" VARCHAR(100),
    "contact_email" VARCHAR(320),
    "phone" VARCHAR(40),
    "invoice_email" VARCHAR(320),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25),
    "invoice_number" VARCHAR(50) NOT NULL,
    "plan_type" "SubscriptionPlan" NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "invoice_type" "InvoiceType" DEFAULT 'initial',
    "previous_plan_type" "SubscriptionPlan",
    "previous_billing_cycle" "BillingCycle",
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "tax_rate" DECIMAL(5,2),
    "tax_amount" DECIMAL(10,2),
    "total_amount" DECIMAL(10,2) NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "pdf_path" VARCHAR(500),
    "file_name" VARCHAR(255),
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "sent_date" TIMESTAMP(3),
    "paid_date" TIMESTAMP(3),
    "billing_snapshot" TEXT NOT NULL,
    "notes" TEXT,
    "admin_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_ledger" (
    "no" SERIAL NOT NULL,
    "id" VARCHAR(25),
    "transaction_type" "TransactionType" NOT NULL,
    "cpa_amount" INTEGER,
    "agent_members" INTEGER,
    "payment_number" VARCHAR(50),
    "payment_amount" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "tax_amount" DECIMAL(10,2),
    "total_amount" DECIMAL(10,2),
    "platform" "PaymentPlatform",
    "payment_method" "PaymentMethod",
    "payment_status" "PaymentStatus",
    "invoice_id" VARCHAR(25),
    "receipt_pdf_path" VARCHAR(500),
    "receipt_url" VARCHAR(1000),
    "payment_date" TIMESTAMP(3),
    "plan_type" "SubscriptionPlan",
    "billing_cycle" "BillingCycle",
    "service_variant" "ServiceVariant",
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_ledger_pkey" PRIMARY KEY ("no")
);

-- CreateTable
CREATE TABLE "invoice_plan_change_schedule" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "current_plan_type" "SubscriptionPlan" NOT NULL,
    "current_billing_cycle" "BillingCycle" NOT NULL,
    "new_plan_type" "SubscriptionPlan" NOT NULL,
    "new_billing_cycle" "BillingCycle" NOT NULL,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_plan_change_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "default_owner_id" VARCHAR(25),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "access_mode" "AgentAccessMode" NOT NULL DEFAULT 'public',
    "vectorStoreId" VARCHAR(50),
    "vectorStoreName" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "google_account_id" VARCHAR(25),
    "google_drive_disconnected" BOOLEAN NOT NULL DEFAULT false,
    "widget_settings" TEXT,
    "widget_icon_url" TEXT,
    "widget_button_settings" TEXT,
    "chat_limit_count" INTEGER NOT NULL DEFAULT 0,
    "continuous_answer_limit" INTEGER NOT NULL DEFAULT 0,
    "chat_limit_message" TEXT,
    "continuous_answer_limit_message" TEXT,
    "chat_limit_duration_minutes" INTEGER NOT NULL DEFAULT 1440,
    "onboard_step" INTEGER NOT NULL DEFAULT 0,
    "ai_config" TEXT,
    "gitbook_access_token" TEXT,
    "gitbook_space_id" VARCHAR(100),
    "gitbook_published_url" VARCHAR(500),
    "gitbook_imported_pages" TEXT,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "no" SERIAL NOT NULL,
    "conversation_id" VARCHAR(255) NOT NULL,
    "client_id" VARCHAR(80),
    "agentId" VARCHAR(20),
    "role" VARCHAR(10) NOT NULL,
    "content" BYTEA,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "model" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "api_key" VARCHAR(50),
    "user_ip" VARCHAR(45),

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("no")
);

-- CreateTable
CREATE TABLE "cpa_usage_log" (
    "no" SERIAL NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "usageDate" DATE NOT NULL,
    "cpaUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_usage_log_pkey" PRIMARY KEY ("no")
);

-- CreateTable
CREATE TABLE "ai_call_cpa_reservations" (
    "id" SERIAL NOT NULL,
    "reservation_id" VARCHAR(40) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "free_charged" INTEGER NOT NULL DEFAULT 0,
    "booster_charged" INTEGER NOT NULL DEFAULT 0,
    "paid_charged" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "log_date" DATE NOT NULL,
    "booster_expires_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'reserved',
    "extra_charged" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "ai_call_cpa_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_members" (
    "id" SERIAL NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(100),
    "auth_method" "AgentMemberAuthMethod" NOT NULL,
    "credential_ref" TEXT,
    "password_hash" TEXT,
    "status" "AgentMemberStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "plan_suspended_at" TIMESTAMP(3),

    CONSTRAINT "agent_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_member_passkeys" (
    "id" VARCHAR(25) NOT NULL,
    "member_id" INTEGER NOT NULL,
    "credential_id" VARCHAR(500) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" VARCHAR(200),
    "device_type" VARCHAR(50),
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "name" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "agent_member_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_member_invitations" (
    "id" SERIAL NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "status" "AgentMemberInvitationStatus" NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "invited_by_user_id" VARCHAR(25),
    "workflow_id" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "agent_member_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_member_password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "member_id" INTEGER NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_member_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_member_email_change_tokens" (
    "id" SERIAL NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "member_id" INTEGER NOT NULL,
    "old_email" VARCHAR(320) NOT NULL,
    "new_email" VARCHAR(320) NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_member_email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage" (
    "id" SERIAL NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'processing',
    "title" VARCHAR(500) NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" VARCHAR(100),
    "content" TEXT,
    "openaiFileId" VARCHAR(50),
    "vectorStoreFileId" VARCHAR(50),
    "sourceUrl" VARCHAR(2000),
    "crawlDepth" INTEGER,
    "crawlCount" INTEGER DEFAULT 1,
    "maxPages" INTEGER,
    "userLanguage" VARCHAR(10),
    "processingLog" TEXT,
    "errorMessage" TEXT,
    "rag_provider" VARCHAR(30),
    "rag_space_id" INTEGER,
    "rag_status" TEXT,
    "blob_path" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_spaces" (
    "id" SERIAL NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymization_requests" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "email_hash" VARCHAR(64) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "status" "AnonymizationStatus" NOT NULL DEFAULT 'pending',
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "fingerprint" VARCHAR(64),
    "account_age" INTEGER NOT NULL,
    "total_cpa_used" INTEGER NOT NULL,
    "is_paid_user" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "anonymization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymization_history" (
    "id" VARCHAR(25) NOT NULL,
    "email_hash" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64),
    "anonymized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_age" INTEGER NOT NULL,
    "total_cpa_used" INTEGER NOT NULL,
    "had_paid_plan" BOOLEAN NOT NULL,
    "agent_count" INTEGER NOT NULL,
    "storage_count" INTEGER NOT NULL,

    CONSTRAINT "anonymization_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" VARCHAR(25) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT,
    "featuredImage" VARCHAR(1000),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "authorId" VARCHAR(25),
    "groupId" VARCHAR(25),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_media" (
    "id" VARCHAR(25) NOT NULL,
    "s3Key" VARCHAR(500) NOT NULL,
    "s3Bucket" VARCHAR(100) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "cdnUrl" VARCHAR(1000) NOT NULL,
    "uploadedBy" VARCHAR(25),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_temp_storage" (
    "id" VARCHAR(25) NOT NULL,
    "conversationId" VARCHAR(255) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "jsonData" TEXT NOT NULL,
    "status" "WorkflowTempStorageStatus" NOT NULL DEFAULT 'pending',
    "wait_node_id" VARCHAR(50),
    "execution_context" TEXT,
    "resume_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_temp_storage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sheets" (
    "id" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20),
    "user_id" VARCHAR(25),
    "project_id" VARCHAR(25),
    "kind" VARCHAR(10) NOT NULL DEFAULT 'agent',
    "template" VARCHAR(80),
    "template_family" VARCHAR(80),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "schema" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sheet_rows" (
    "id" VARCHAR(25) NOT NULL,
    "sheet_id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'agent',
    "project_id" VARCHAR(25),
    "user_id" VARCHAR(25),
    "row_data" TEXT NOT NULL,
    "sealed" BYTEA,
    "confirmed" BOOLEAN,
    "confirmed_by" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sheet_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_groups" (
    "id" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(20),
    "is_expanded" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_group_items" (
    "id" VARCHAR(25) NOT NULL,
    "group_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_group_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_group_data_sheets" (
    "id" VARCHAR(25) NOT NULL,
    "group_id" VARCHAR(25) NOT NULL,
    "sheet_id" VARCHAR(25) NOT NULL,
    "sheet_kind" VARCHAR(10) NOT NULL DEFAULT 'agent',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_group_data_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" SERIAL NOT NULL,
    "workflowId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "workflow_json" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "traffic_weight" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template_binding" TEXT,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'main',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_version" (
    "id" SERIAL NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "version" INTEGER NOT NULL,
    "workflow_json" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "source" VARCHAR(20) NOT NULL,
    "created_by_id" VARCHAR(25),
    "note" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_connections" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "provider" "WorkflowConnectionProvider" NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "server_url" VARCHAR(500),
    "transport" "WorkflowConnectionTransport" NOT NULL DEFAULT 'streamable_http',
    "protocol_version" VARCHAR(20),
    "auth_type" "WorkflowConnectionAuthType" NOT NULL DEFAULT 'none',
    "encrypted_token" TEXT,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "oauth_scope" VARCHAR(500),
    "oauth_client_id" TEXT,
    "oauth_client_secret" TEXT,
    "oauth_redirect_uri" VARCHAR(500),
    "oauth_auth_url" VARCHAR(500),
    "oauth_token_url" VARCHAR(500),
    "oauth_mode" VARCHAR(10),
    "service_config" TEXT,
    "session_id" VARCHAR(255),
    "last_event_id" VARCHAR(255),
    "workflow_id" VARCHAR(25),
    "status" "WorkflowConnectionStatus" NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_oauth_app" (
    "id" SERIAL NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_oauth_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_service_config" (
    "id" SERIAL NOT NULL,
    "service" VARCHAR(30) NOT NULL,
    "config_json" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_service_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_update_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "android_min_version" INTEGER NOT NULL DEFAULT 0,
    "android_recommended_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_update_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_calendar_accounts" (
    "id" VARCHAR(25) NOT NULL,
    "connection_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "owner_email" VARCHAR(254) NOT NULL,
    "label" VARCHAR(120),
    "encrypted_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "oauth_scope" VARCHAR(500),
    "status" "WorkflowCalendarAccountStatus" NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_calendar_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_visitor_contacts" (
    "id" VARCHAR(25) NOT NULL,
    "voice_client_id" VARCHAR(64) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "encrypted_phone" BYTEA,
    "encrypted_email" BYTEA,
    "lookup_hits" INTEGER NOT NULL DEFAULT 1,
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_visitor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_index" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "account_id" VARCHAR(25) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "calendar_id" VARCHAR(255) NOT NULL,
    "external_event_id" VARCHAR(1024) NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_schedules" (
    "id" VARCHAR(25) NOT NULL,
    "workflowId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "cron_expression" VARCHAR(100) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_template_category" (
    "id" VARCHAR(25) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wf_template_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_template" (
    "id" VARCHAR(25) NOT NULL,
    "template_id" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "category_code" VARCHAR(50) NOT NULL,
    "complexity" "WorkflowTemplateComplexity" NOT NULL DEFAULT 'beginner',
    "keywords" TEXT NOT NULL,
    "node_types" TEXT NOT NULL,
    "features" TEXT NOT NULL,
    "workflow_json" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "bundle_json" TEXT,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_ips" (
    "id" SERIAL NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "country" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(100),

    CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_ai_assistant_sessions" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25),
    "provider" VARCHAR(20),
    "model" VARCHAR(50),
    "summary" TEXT,
    "previous_response_id" VARCHAR(100),
    "entity_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_ai_assistant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_ai_assistant_messages" (
    "id" VARCHAR(25) NOT NULL,
    "session_id" VARCHAR(25) NOT NULL,
    "role" "WorkflowAiAssistantMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "is_summarized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_ai_assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_channels" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "platform" "BotChannelPlatform" NOT NULL,
    "encrypted_token" TEXT,
    "bot_username" VARCHAR(100),
    "bot_name" VARCHAR(200),
    "webhook_url" VARCHAR(500),
    "webhook_secret" VARCHAR(100),
    "status" "BotChannelStatus" NOT NULL DEFAULT 'inactive',
    "verification_code" VARCHAR(10),
    "verification_expires_at" TIMESTAMP(3),
    "verified_telegram_id" VARCHAR(50),
    "slack_client_id" VARCHAR(50),
    "slack_client_secret" TEXT,
    "slack_signing_secret" TEXT,
    "slack_team_id" VARCHAR(20),
    "slack_team_name" VARCHAR(200),
    "slack_bot_user_id" VARCHAR(20),
    "allowed_user_ids" TEXT,
    "last_used_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_phone_numbers" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "connection_id" VARCHAR(25) NOT NULL,
    "phone_number" VARCHAR(30) NOT NULL,
    "country_code" VARCHAR(5),
    "display_name" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "agentId" VARCHAR(20) NOT NULL,
    "workflow_id" VARCHAR(25),
    "call_connection_id" VARCHAR(100) NOT NULL,
    "server_call_id" VARCHAR(500),
    "direction" "CallDirection" NOT NULL,
    "caller_number" VARCHAR(30),
    "caller_number_enc" BYTEA,
    "callee_number" VARCHAR(30) NOT NULL,
    "status" "CallSessionStatus" NOT NULL DEFAULT 'ringing',
    "chat_history" TEXT,
    "language" VARCHAR(20) NOT NULL DEFAULT 'de-CH',
    "voice_name" VARCHAR(100),
    "realtime_session_id" VARCHAR(200),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_voice_sessions" (
    "id" VARCHAR(25) NOT NULL,
    "session_id" VARCHAR(60) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "workflow_id" VARCHAR(25),
    "mode" VARCHAR(10) NOT NULL DEFAULT 'test',
    "language" VARCHAR(20),
    "voice_name" VARCHAR(100),
    "chat_history" TEXT,
    "user_ip" VARCHAR(45),
    "duration_seconds" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_cost_metrics" (
    "id" VARCHAR(25) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" VARCHAR(100) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "workflow_id" VARCHAR(25),
    "channel" VARCHAR(20) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER NOT NULL,
    "billed_minutes" INTEGER NOT NULL,
    "attempted_cpa" INTEGER NOT NULL,
    "actual_charged_cpa" INTEGER,
    "cpa_clamped" BOOLEAN,
    "cpa_deducted_at" TIMESTAMP(3),
    "cpa_deduction_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "language" VARCHAR(20),
    "voice_name" VARCHAR(100),
    "llm_deployment" VARCHAR(100),
    "llm_calls" INTEGER NOT NULL DEFAULT 0,
    "llm_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "llm_cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "llm_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "llm_usage_missing" INTEGER NOT NULL DEFAULT 0,
    "llm_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "llm_cost_source" VARCHAR(20) NOT NULL DEFAULT 'captured',
    "stt_audio_seconds" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stt_active_seconds" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stt_recognized_utterances" INTEGER NOT NULL DEFAULT 0,
    "stt_recognized_chars" INTEGER NOT NULL DEFAULT 0,
    "stt_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "tts_requests" INTEGER NOT NULL DEFAULT 0,
    "tts_chars" INTEGER NOT NULL DEFAULT 0,
    "tts_hd_requests" INTEGER NOT NULL DEFAULT 0,
    "tts_standard_requests" INTEGER NOT NULL DEFAULT 0,
    "tts_fallback_count" INTEGER NOT NULL DEFAULT 0,
    "tts_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "tool_total_ms" INTEGER NOT NULL DEFAULT 0,
    "rag_tool_calls" INTEGER NOT NULL DEFAULT 0,
    "calendar_tool_calls" INTEGER NOT NULL DEFAULT 0,
    "sms_tool_calls" INTEGER NOT NULL DEFAULT 0,
    "other_tool_calls" INTEGER NOT NULL DEFAULT 0,
    "rag_result_buckets" JSONB NOT NULL DEFAULT '{}',
    "calendar_result_buckets" JSONB NOT NULL DEFAULT '{}',
    "sms_result_buckets" JSONB NOT NULL DEFAULT '{}',
    "other_result_buckets" JSONB NOT NULL DEFAULT '{}',
    "total_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "cost_per_minute_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_revenue_starter" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_revenue_standard" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_revenue_pro" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_margin_starter" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_margin_standard" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempted_margin_pro" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "actual_revenue_starter" DECIMAL(12,6),
    "actual_revenue_standard" DECIMAL(12,6),
    "actual_revenue_pro" DECIMAL(12,6),
    "actual_margin_starter" DECIMAL(12,6),
    "actual_margin_standard" DECIMAL(12,6),
    "actual_margin_pro" DECIMAL(12,6),
    "sample_rate" DECIMAL(5,4) NOT NULL,
    "sample_reason" VARCHAR(40) NOT NULL,
    "force_agent" BOOLEAN NOT NULL DEFAULT false,
    "collector_version" VARCHAR(20) NOT NULL,
    "rate_version" VARCHAR(20) NOT NULL,
    "llm_rate_input_per_million" DECIMAL(10,4) NOT NULL,
    "llm_rate_cached_input_per_million" DECIMAL(10,4) NOT NULL,
    "llm_rate_output_per_million" DECIMAL(10,4) NOT NULL,
    "stt_rate_per_hour" DECIMAL(10,4) NOT NULL,
    "tts_rate_per_million_chars" DECIMAL(10,4) NOT NULL,
    "tts_hd_rate_per_million_chars" DECIMAL(10,4) NOT NULL DEFAULT 30,
    "tts_standard_rate_per_million_chars" DECIMAL(10,4) NOT NULL DEFAULT 4,

    CONSTRAINT "voice_cost_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" VARCHAR(25) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "contact_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(40),
    "country" VARCHAR(2) NOT NULL,
    "contract_status" "PartnerContractStatus" NOT NULL DEFAULT 'prospect',
    "revenue_share_pct" INTEGER NOT NULL DEFAULT 10,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_leads" (
    "id" VARCHAR(25) NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "contact_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(40),
    "country" VARCHAR(2),
    "use_case" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" VARCHAR(100),
    "reviewed_at" TIMESTAMP(3),
    "user_id" VARCHAR(25),
    "partner_id" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_app_payloads" (
    "id" SERIAL NOT NULL,
    "payload_id" VARCHAR(25) NOT NULL,
    "assignment_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "mini_app_type" VARCHAR(20) NOT NULL,
    "subject_type" VARCHAR(10) NOT NULL,
    "subject_id" VARCHAR(30) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload_json" TEXT,
    "adaptive_meta" TEXT,
    "error_detail" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'generating',
    "attempt_expires_at" TIMESTAMP(3) NOT NULL,
    "solved_at" TIMESTAMP(3),
    "delete_at" TIMESTAMP(3),
    "generation_started_at" TIMESTAMP(3) NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "generation_attempt_id" VARCHAR(40) NOT NULL,
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mini_app_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_push_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT,
    "agent_member_id" INTEGER,
    "platform" VARCHAR(10) NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "device_id" VARCHAR(100) NOT NULL,
    "app_version" VARCHAR(20),
    "mini_app_schema_versions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_app_push_logs" (
    "id" SERIAL NOT NULL,
    "assignment_id" VARCHAR(25) NOT NULL,
    "token_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mini_app_push_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_app_results" (
    "id" SERIAL NOT NULL,
    "payload_id" VARCHAR(25) NOT NULL,
    "subject_type" VARCHAR(10) NOT NULL,
    "subject_id" VARCHAR(30) NOT NULL,
    "result_json" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mini_app_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_app_assignments" (
    "id" SERIAL NOT NULL,
    "assignment_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "mini_app_type" VARCHAR(20) NOT NULL,
    "mini_app_node_id" VARCHAR(50) NOT NULL,
    "config_snapshot" TEXT NOT NULL,
    "schedule_run_key" VARCHAR(80) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "attempt_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mini_app_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_learning_state" (
    "id" SERIAL NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "subject_type" VARCHAR(10) NOT NULL,
    "subject_id" VARCHAR(30) NOT NULL,
    "mastery_json" TEXT NOT NULL,
    "review_queue_json" TEXT NOT NULL,
    "source_fingerprint" VARCHAR(64),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_learning_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_app_generation_charges" (
    "id" SERIAL NOT NULL,
    "charge_id" VARCHAR(40) NOT NULL,
    "payload_id" VARCHAR(25) NOT NULL,
    "attempt_id" VARCHAR(40) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "free_charged" INTEGER NOT NULL DEFAULT 0,
    "booster_charged" INTEGER NOT NULL DEFAULT 0,
    "paid_charged" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "log_date" TIMESTAMP(3) NOT NULL,
    "booster_expires_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'charged',
    "refunded_at" TIMESTAMP(3),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_micro_usd" INTEGER,
    "shortfall_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mini_app_generation_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_rounds" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "workflow_id" VARCHAR(25) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "round_no" INTEGER,
    "round_language" VARCHAR(8),
    "round_locale" VARCHAR(16),
    "call_connection_id" VARCHAR(100) NOT NULL,
    "member_key" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "questions_json" TEXT NOT NULL,
    "lesson_text" TEXT NOT NULL DEFAULT '',
    "current_index" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "results_json" TEXT NOT NULL DEFAULT '[]',
    "hints_used" INTEGER NOT NULL DEFAULT 0,
    "unrecognized" INTEGER NOT NULL DEFAULT 0,
    "topic" VARCHAR(100) NOT NULL DEFAULT 'general',
    "fail_reason" VARCHAR(200),
    "gen_model" VARCHAR(64),
    "gen_input_tokens" INTEGER,
    "gen_output_tokens" INTEGER,
    "gen_cost_micro_usd" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "voice_quiz_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_lessons" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "lesson_no" INTEGER NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'ko-KR',
    "title" VARCHAR(100) NOT NULL DEFAULT '',
    "lesson_text" TEXT NOT NULL DEFAULT '',
    "questions_json" TEXT NOT NULL,
    "settings_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_quiz_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_progress" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "member_key" VARCHAR(64) NOT NULL,
    "round_no" INTEGER NOT NULL,
    "round_id" VARCHAR(25),
    "correct" INTEGER NOT NULL DEFAULT 0,
    "asked" INTEGER NOT NULL DEFAULT 0,
    "earned" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_quiz_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_withdrawals" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "member_key" VARCHAR(64) NOT NULL,
    "anon_key" VARCHAR(64) NOT NULL,
    "stage" VARCHAR(24) NOT NULL DEFAULT 'fenced',
    "target_round_id" VARCHAR(25),
    "hook_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_quiz_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_consents" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "stage" VARCHAR(16) NOT NULL,
    "member_key" VARCHAR(64) NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "notice_hash" VARCHAR(64) NOT NULL,
    "lang" VARCHAR(8) NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_after_ms" INTEGER NOT NULL,
    "digit" VARCHAR(2) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "export_id" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_quiz_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_consent_notices" (
    "agent_id" VARCHAR(20) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "lang" VARCHAR(8) NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_quiz_consent_notices_pkey" PRIMARY KEY ("agent_id","hash")
);

-- CreateTable
CREATE TABLE "voice_quiz_consent_exports" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(30) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'preparing',
    "blob_path" VARCHAR(500),
    "region_id" VARCHAR(40) NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "period_from" TIMESTAMP(3),
    "period_to" TIMESTAMP(3),
    "downloaded_at" TIMESTAMP(3),
    "notify_stage" INTEGER NOT NULL DEFAULT 0,
    "notified_at" TIMESTAMP(3),
    "purge_at" TIMESTAMP(3) NOT NULL,
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_quiz_consent_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_reservations" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "group_key" VARCHAR(24) NOT NULL,
    "member_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "voice_quiz_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_dial_claims" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "group_key" VARCHAR(24) NOT NULL,
    "call_date" VARCHAR(10) NOT NULL,
    "member_key" VARCHAR(64) NOT NULL,
    "round_no" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'none',
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "dialed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voice_quiz_dial_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_quiz_member_actions" (
    "id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(20) NOT NULL,
    "program_id" VARCHAR(40) NOT NULL DEFAULT 'default',
    "member_key" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "source_group" VARCHAR(24),
    "target_group" VARCHAR(24),
    "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "seq" INTEGER NOT NULL,
    "action_key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "swept_at" TIMESTAMP(3),
    "last_failure" VARCHAR(200),
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "voice_quiz_member_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_fx_rate" (
    "id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "valid_for" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "unit" INTEGER NOT NULL,
    "source" VARCHAR(200) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vat_fx_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_fx_rate_manual" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "export_key" VARCHAR(64) NOT NULL,
    "date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "source" VARCHAR(200) NOT NULL,

    CONSTRAINT "vat_fx_rate_manual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_project" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "workflow_id" VARCHAR(25),
    "workflow_linked_at" TIMESTAMP(3),
    "kind" VARCHAR(40) NOT NULL DEFAULT 'free',
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "settings" BYTEA,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_id" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reference" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "from_project_id" VARCHAR(25) NOT NULL,
    "to_project_id" VARCHAR(25) NOT NULL,
    "sheets" TEXT[],
    "include_unconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "status" VARCHAR(12) NOT NULL DEFAULT 'open',
    "submitted_at" TIMESTAMP(3),
    "current_submission_id" VARCHAR(25),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_row_key" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "template_family" VARCHAR(120) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "row_id" VARCHAR(25) NOT NULL,

    CONSTRAINT "sheet_row_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_row_pair" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "from_row_id" VARCHAR(25) NOT NULL,
    "to_row_id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_row_pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_note" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25),
    "kind" VARCHAR(12) NOT NULL,
    "body" BYTEA NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'accepted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_message" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25),
    "role" VARCHAR(10) NOT NULL,
    "actor" VARCHAR(40) NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_event" (
    "id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25),
    "sheet_id" VARCHAR(25),
    "row_id" VARCHAR(25),
    "task_id" VARCHAR(25),
    "submission_id" VARCHAR(25),
    "file_id" VARCHAR(25),
    "note_id" VARCHAR(25),
    "actor" VARCHAR(120) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "payload" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_submission" (
    "id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "number" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" BYTEA NOT NULL,
    "ref_ack_digest" VARCHAR(64),

    CONSTRAINT "work_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_file" (
    "id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "parent_file_id" VARCHAR(25),
    "blob_region" VARCHAR(30) NOT NULL,
    "blob_path" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "payload" BYTEA NOT NULL,
    "read_text" BYTEA,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_file" (
    "id" VARCHAR(25) NOT NULL,
    "task_id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_task_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_submission_source" (
    "id" VARCHAR(25) NOT NULL,
    "submission_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "source_project_id" VARCHAR(25) NOT NULL,
    "source_task_id" VARCHAR(25) NOT NULL,

    CONSTRAINT "work_submission_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_submission_file" (
    "id" VARCHAR(25) NOT NULL,
    "submission_id" VARCHAR(25) NOT NULL,
    "file_id" VARCHAR(25) NOT NULL,
    "project_id" VARCHAR(25) NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_submission_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_tokens_token_key" ON "email_change_tokens"("token");

-- CreateIndex
CREATE INDEX "email_change_tokens_user_id_idx" ON "email_change_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_change_tokens_new_email_idx" ON "email_change_tokens"("new_email");

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_userId_idx" ON "passkeys"("userId");

-- CreateIndex
CREATE INDEX "email_resend_attempts_email_attemptAt_idx" ON "email_resend_attempts"("email", "attemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_access_token_token_hash_key" ON "mcp_access_token"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_access_token_user_id_idx" ON "mcp_access_token"("user_id");

-- CreateIndex
CREATE INDEX "mcp_audit_log_token_id_created_at_idx" ON "mcp_audit_log"("token_id", "created_at");

-- CreateIndex
CREATE INDEX "mcp_audit_log_user_id_created_at_idx" ON "mcp_audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "mcp_rate_bucket_window_start_idx" ON "mcp_rate_bucket"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_rate_bucket_token_id_class_window_start_key" ON "mcp_rate_bucket"("token_id", "class", "window_start");

-- CreateIndex
CREATE INDEX "mcp_deploy_request_user_id_status_idx" ON "mcp_deploy_request"("user_id", "status");

-- CreateIndex
CREATE INDEX "mcp_deploy_request_workflow_id_idx" ON "mcp_deploy_request"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_refresh_token_token_hash_key" ON "app_refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "app_refresh_token_user_id_idx" ON "app_refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "app_refresh_token_agent_member_id_idx" ON "app_refresh_token"("agent_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_config_user_id_key" ON "analytics_config"("user_id");

-- CreateIndex
CREATE INDEX "rag_stores_agentId_idx" ON "rag_stores"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "rag_stores_agentId_provider_key" ON "rag_stores"("agentId", "provider");

-- CreateIndex
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

-- CreateIndex
CREATE INDEX "subscription_booster_expires_at_idx" ON "subscription"("booster_expires_at");

-- CreateIndex
CREATE INDEX "booster_purchases_userId_purchased_at_idx" ON "booster_purchases"("userId", "purchased_at");

-- CreateIndex
CREATE INDEX "booster_purchases_expires_at_idx" ON "booster_purchases"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "managed_region_config_region_id_key" ON "managed_region_config"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");

-- CreateIndex
CREATE INDEX "invoices_invoice_number_idx" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_issue_date_idx" ON "invoices"("issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_ledger_payment_number_key" ON "cpa_ledger"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_ledger_invoice_id_key" ON "cpa_ledger"("invoice_id");

-- CreateIndex
CREATE INDEX "cpa_ledger_id_idx" ON "cpa_ledger"("id");

-- CreateIndex
CREATE INDEX "cpa_ledger_transaction_type_idx" ON "cpa_ledger"("transaction_type");

-- CreateIndex
CREATE INDEX "cpa_ledger_platform_idx" ON "cpa_ledger"("platform");

-- CreateIndex
CREATE INDEX "cpa_ledger_payment_status_idx" ON "cpa_ledger"("payment_status");

-- CreateIndex
CREATE INDEX "cpa_ledger_payment_number_idx" ON "cpa_ledger"("payment_number");

-- CreateIndex
CREATE INDEX "cpa_ledger_invoice_id_idx" ON "cpa_ledger"("invoice_id");

-- CreateIndex
CREATE INDEX "cpa_ledger_created_at_idx" ON "cpa_ledger"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_plan_change_schedule_userId_key" ON "invoice_plan_change_schedule"("userId");

-- CreateIndex
CREATE INDEX "invoice_plan_change_schedule_userId_idx" ON "invoice_plan_change_schedule"("userId");

-- CreateIndex
CREATE INDEX "invoice_plan_change_schedule_scheduled_date_idx" ON "invoice_plan_change_schedule"("scheduled_date");

-- CreateIndex
CREATE INDEX "invoice_plan_change_schedule_status_idx" ON "invoice_plan_change_schedule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_agentId_key" ON "agents"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_default_owner_id_key" ON "agents"("default_owner_id");

-- CreateIndex
CREATE INDEX "agents_agentId_idx" ON "agents"("agentId");

-- CreateIndex
CREATE INDEX "agents_userId_idx" ON "agents"("userId");

-- CreateIndex
CREATE INDEX "agents_vectorStoreId_idx" ON "agents"("vectorStoreId");

-- CreateIndex
CREATE INDEX "agents_google_account_id_idx" ON "agents"("google_account_id");

-- CreateIndex
CREATE INDEX "conversation_agentId_role_created_at_idx" ON "conversation"("agentId", "role", "created_at");

-- CreateIndex
CREATE INDEX "conversation_client_id_idx" ON "conversation"("client_id");

-- CreateIndex
CREATE INDEX "conversation_conversation_id_idx" ON "conversation"("conversation_id");

-- CreateIndex
CREATE INDEX "cpa_usage_log_agentId_idx" ON "cpa_usage_log"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_usage_log_agentId_usageDate_key" ON "cpa_usage_log"("agentId", "usageDate");

-- CreateIndex
CREATE UNIQUE INDEX "ai_call_cpa_reservations_reservation_id_key" ON "ai_call_cpa_reservations"("reservation_id");

-- CreateIndex
CREATE INDEX "ai_call_cpa_reservations_status_expires_at_idx" ON "ai_call_cpa_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ai_call_cpa_reservations_status_closed_at_idx" ON "ai_call_cpa_reservations"("status", "closed_at");

-- CreateIndex
CREATE INDEX "agent_members_agent_id_idx" ON "agent_members"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_members_agent_id_email_key" ON "agent_members"("agent_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_member_passkeys_credential_id_key" ON "agent_member_passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "agent_member_passkeys_member_id_idx" ON "agent_member_passkeys"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_member_invitations_token_key" ON "agent_member_invitations"("token");

-- CreateIndex
CREATE INDEX "agent_member_invitations_agent_id_idx" ON "agent_member_invitations"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_member_password_reset_tokens_token_key" ON "agent_member_password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "agent_member_password_reset_tokens_agent_id_email_idx" ON "agent_member_password_reset_tokens"("agent_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_member_email_change_tokens_token_key" ON "agent_member_email_change_tokens"("token");

-- CreateIndex
CREATE INDEX "agent_member_email_change_tokens_agent_id_member_id_idx" ON "agent_member_email_change_tokens"("agent_id", "member_id");

-- CreateIndex
CREATE INDEX "storage_agentId_type_idx" ON "storage"("agentId", "type");

-- CreateIndex
CREATE INDEX "storage_agentId_status_idx" ON "storage"("agentId", "status");

-- CreateIndex
CREATE INDEX "storage_agentId_rag_provider_idx" ON "storage"("agentId", "rag_provider");

-- CreateIndex
CREATE INDEX "storage_agentId_rag_space_id_idx" ON "storage"("agentId", "rag_space_id");

-- CreateIndex
CREATE INDEX "storage_openaiFileId_idx" ON "storage"("openaiFileId");

-- CreateIndex
CREATE INDEX "rag_spaces_agentId_idx" ON "rag_spaces"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "rag_spaces_agentId_name_key" ON "rag_spaces"("agentId", "name");

-- CreateIndex
CREATE INDEX "anonymization_requests_userId_idx" ON "anonymization_requests"("userId");

-- CreateIndex
CREATE INDEX "anonymization_requests_status_idx" ON "anonymization_requests"("status");

-- CreateIndex
CREATE INDEX "anonymization_requests_scheduled_at_idx" ON "anonymization_requests"("scheduled_at");

-- CreateIndex
CREATE INDEX "anonymization_history_email_hash_idx" ON "anonymization_history"("email_hash");

-- CreateIndex
CREATE INDEX "anonymization_history_fingerprint_idx" ON "anonymization_history"("fingerprint");

-- CreateIndex
CREATE INDEX "anonymization_history_anonymized_at_idx" ON "anonymization_history"("anonymized_at");

-- CreateIndex
CREATE INDEX "blog_posts_slug_idx" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_language_idx" ON "blog_posts"("language");

-- CreateIndex
CREATE INDEX "blog_posts_groupId_idx" ON "blog_posts"("groupId");

-- CreateIndex
CREATE INDEX "blog_posts_published_publishedAt_idx" ON "blog_posts"("published", "publishedAt");

-- CreateIndex
CREATE INDEX "blog_posts_authorId_idx" ON "blog_posts"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_language_key" ON "blog_posts"("slug", "language");

-- CreateIndex
CREATE UNIQUE INDEX "blog_media_s3Key_key" ON "blog_media"("s3Key");

-- CreateIndex
CREATE INDEX "blog_media_s3Key_idx" ON "blog_media"("s3Key");

-- CreateIndex
CREATE INDEX "blog_media_uploadedBy_idx" ON "blog_media"("uploadedBy");

-- CreateIndex
CREATE INDEX "blog_media_createdAt_idx" ON "blog_media"("createdAt");

-- CreateIndex
CREATE INDEX "workflow_temp_storage_conversationId_idx" ON "workflow_temp_storage"("conversationId");

-- CreateIndex
CREATE INDEX "workflow_temp_storage_agentId_idx" ON "workflow_temp_storage"("agentId");

-- CreateIndex
CREATE INDEX "workflow_temp_storage_status_idx" ON "workflow_temp_storage"("status");

-- CreateIndex
CREATE INDEX "workflow_temp_storage_wait_node_id_idx" ON "workflow_temp_storage"("wait_node_id");

-- CreateIndex
CREATE INDEX "data_sheets_agentId_idx" ON "data_sheets"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "data_sheets_agentId_name_key" ON "data_sheets"("agentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "data_sheets_project_id_name_key" ON "data_sheets"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "data_sheets_id_kind_key" ON "data_sheets"("id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "data_sheets_id_project_id_user_id_key" ON "data_sheets"("id", "project_id", "user_id");

-- CreateIndex
CREATE INDEX "data_sheet_rows_sheet_id_idx" ON "data_sheet_rows"("sheet_id");

-- CreateIndex
CREATE INDEX "idx_sheet_created" ON "data_sheet_rows"("sheet_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_sheet_updated" ON "data_sheet_rows"("sheet_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_sheet_rows_id_project_id_user_id_key" ON "data_sheet_rows"("id", "project_id", "user_id");

-- CreateIndex
CREATE INDEX "workflow_groups_agentId_idx" ON "workflow_groups"("agentId");

-- CreateIndex
CREATE INDEX "workflow_group_items_group_id_idx" ON "workflow_group_items"("group_id");

-- CreateIndex
CREATE INDEX "workflow_group_items_workflow_id_idx" ON "workflow_group_items"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_group_items_group_id_workflow_id_key" ON "workflow_group_items"("group_id", "workflow_id");

-- CreateIndex
CREATE INDEX "workflow_group_data_sheets_group_id_idx" ON "workflow_group_data_sheets"("group_id");

-- CreateIndex
CREATE INDEX "workflow_group_data_sheets_sheet_id_idx" ON "workflow_group_data_sheets"("sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_group_data_sheets_group_id_sheet_id_key" ON "workflow_group_data_sheets"("group_id", "sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_workflowId_key" ON "workflows"("workflowId");

-- CreateIndex
CREATE INDEX "workflows_agentId_idx" ON "workflows"("agentId");

-- CreateIndex
CREATE INDEX "workflows_status_idx" ON "workflows"("status");

-- CreateIndex
CREATE INDEX "workflows_agentId_kind_idx" ON "workflows"("agentId", "kind");

-- CreateIndex
CREATE INDEX "workflow_version_workflow_id_idx" ON "workflow_version"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_version_workflow_id_version_key" ON "workflow_version"("workflow_id", "version");

-- CreateIndex
CREATE INDEX "workflow_connections_userId_idx" ON "workflow_connections"("userId");

-- CreateIndex
CREATE INDEX "workflow_connections_agentId_idx" ON "workflow_connections"("agentId");

-- CreateIndex
CREATE INDEX "workflow_connections_status_idx" ON "workflow_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_connections_agentId_provider_label_key" ON "workflow_connections"("agentId", "provider", "label");

-- CreateIndex
CREATE UNIQUE INDEX "shared_oauth_app_provider_key" ON "shared_oauth_app"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "global_service_config_service_key" ON "global_service_config"("service");

-- CreateIndex
CREATE INDEX "workflow_calendar_accounts_user_id_idx" ON "workflow_calendar_accounts"("user_id");

-- CreateIndex
CREATE INDEX "workflow_calendar_accounts_agent_id_idx" ON "workflow_calendar_accounts"("agent_id");

-- CreateIndex
CREATE INDEX "workflow_calendar_accounts_status_idx" ON "workflow_calendar_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_calendar_accounts_connection_id_owner_email_key" ON "workflow_calendar_accounts"("connection_id", "owner_email");

-- CreateIndex
CREATE INDEX "web_visitor_contacts_user_id_idx" ON "web_visitor_contacts"("user_id");

-- CreateIndex
CREATE INDEX "web_visitor_contacts_expires_at_idx" ON "web_visitor_contacts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_visitor_contacts_voice_client_id_agent_id_key" ON "web_visitor_contacts"("voice_client_id", "agent_id");

-- CreateIndex
CREATE INDEX "booking_index_user_id_status_start_at_idx" ON "booking_index"("user_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "booking_index_user_id_created_at_idx" ON "booking_index"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_index_account_id_calendar_id_external_event_id_key" ON "booking_index"("account_id", "calendar_id", "external_event_id");

-- CreateIndex
CREATE INDEX "workflow_schedules_enabled_next_run_at_idx" ON "workflow_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "workflow_schedules_agentId_idx" ON "workflow_schedules"("agentId");

-- CreateIndex
CREATE INDEX "workflow_schedules_workflowId_idx" ON "workflow_schedules"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "wf_template_category_code_key" ON "wf_template_category"("code");

-- CreateIndex
CREATE INDEX "wf_template_category_sort_order_idx" ON "wf_template_category"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_template_template_id_key" ON "workflow_template"("template_id");

-- CreateIndex
CREATE INDEX "workflow_template_category_code_idx" ON "workflow_template"("category_code");

-- CreateIndex
CREATE INDEX "workflow_template_is_built_in_idx" ON "workflow_template"("is_built_in");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_ips_ip_key" ON "blocked_ips"("ip");

-- CreateIndex
CREATE INDEX "blocked_ips_is_active_idx" ON "blocked_ips"("is_active");

-- CreateIndex
CREATE INDEX "blocked_ips_ip_idx" ON "blocked_ips"("ip");

-- CreateIndex
CREATE INDEX "workflow_ai_assistant_sessions_user_id_idx" ON "workflow_ai_assistant_sessions"("user_id");

-- CreateIndex
CREATE INDEX "workflow_ai_assistant_sessions_workflow_id_idx" ON "workflow_ai_assistant_sessions"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_ai_assistant_messages_session_id_idx" ON "workflow_ai_assistant_messages"("session_id");

-- CreateIndex
CREATE INDEX "idx_session_created" ON "workflow_ai_assistant_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "bot_channels_userId_idx" ON "bot_channels"("userId");

-- CreateIndex
CREATE INDEX "bot_channels_agentId_idx" ON "bot_channels"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_channels_agentId_platform_key" ON "bot_channels"("agentId", "platform");

-- CreateIndex
CREATE INDEX "call_phone_numbers_phone_number_idx" ON "call_phone_numbers"("phone_number");

-- CreateIndex
CREATE INDEX "call_phone_numbers_agentId_idx" ON "call_phone_numbers"("agentId");

-- CreateIndex
CREATE INDEX "call_phone_numbers_connection_id_idx" ON "call_phone_numbers"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_phone_numbers_agentId_phone_number_key" ON "call_phone_numbers"("agentId", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "call_sessions_call_connection_id_key" ON "call_sessions"("call_connection_id");

-- CreateIndex
CREATE INDEX "call_sessions_agentId_idx" ON "call_sessions"("agentId");

-- CreateIndex
CREATE INDEX "call_sessions_call_connection_id_idx" ON "call_sessions"("call_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_voice_sessions_session_id_key" ON "web_voice_sessions"("session_id");

-- CreateIndex
CREATE INDEX "web_voice_sessions_agent_id_idx" ON "web_voice_sessions"("agent_id");

-- CreateIndex
CREATE INDEX "voice_cost_metrics_created_at_idx" ON "voice_cost_metrics"("created_at");

-- CreateIndex
CREATE INDEX "voice_cost_metrics_agent_id_created_at_idx" ON "voice_cost_metrics"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_cost_metrics_channel_mode_created_at_idx" ON "voice_cost_metrics"("channel", "mode", "created_at");

-- CreateIndex
CREATE INDEX "voice_cost_metrics_channel_created_at_idx" ON "voice_cost_metrics"("channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_cost_metrics_channel_session_id_key" ON "voice_cost_metrics"("channel", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_is_active_idx" ON "partners"("is_active");

-- CreateIndex
CREATE INDEX "partners_country_idx" ON "partners"("country");

-- CreateIndex
CREATE INDEX "trial_leads_status_idx" ON "trial_leads"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_payloads_payload_id_key" ON "mini_app_payloads"("payload_id");

-- CreateIndex
CREATE INDEX "mini_app_payloads_user_id_mini_app_type_status_idx" ON "mini_app_payloads"("user_id", "mini_app_type", "status");

-- CreateIndex
CREATE INDEX "mini_app_payloads_agent_id_subject_type_subject_id_idx" ON "mini_app_payloads"("agent_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "mini_app_payloads_delete_at_idx" ON "mini_app_payloads"("delete_at");

-- CreateIndex
CREATE INDEX "mini_app_payloads_attempt_expires_at_idx" ON "mini_app_payloads"("attempt_expires_at");

-- CreateIndex
CREATE INDEX "mini_app_payloads_status_lease_expires_at_idx" ON "mini_app_payloads"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_payloads_assignment_id_subject_type_subject_id_key" ON "mini_app_payloads"("assignment_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_push_tokens_token_key" ON "app_push_tokens"("token");

-- CreateIndex
CREATE INDEX "app_push_tokens_user_id_enabled_idx" ON "app_push_tokens"("user_id", "enabled");

-- CreateIndex
CREATE INDEX "app_push_tokens_agent_member_id_enabled_idx" ON "app_push_tokens"("agent_member_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "app_push_tokens_user_id_device_id_key" ON "app_push_tokens"("user_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_push_tokens_agent_member_id_device_id_key" ON "app_push_tokens"("agent_member_id", "device_id");

-- CreateIndex
CREATE INDEX "mini_app_push_logs_token_id_idx" ON "mini_app_push_logs"("token_id");

-- CreateIndex
CREATE INDEX "mini_app_push_logs_status_updated_at_idx" ON "mini_app_push_logs"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_push_logs_assignment_id_token_id_key" ON "mini_app_push_logs"("assignment_id", "token_id");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_results_payload_id_subject_type_subject_id_key" ON "mini_app_results"("payload_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_assignments_assignment_id_key" ON "mini_app_assignments"("assignment_id");

-- CreateIndex
CREATE INDEX "mini_app_assignments_user_id_mini_app_type_attempt_expires__idx" ON "mini_app_assignments"("user_id", "mini_app_type", "attempt_expires_at");

-- CreateIndex
CREATE INDEX "mini_app_assignments_agent_id_mini_app_type_attempt_expires_idx" ON "mini_app_assignments"("agent_id", "mini_app_type", "attempt_expires_at");

-- CreateIndex
CREATE INDEX "mini_app_assignments_attempt_expires_at_idx" ON "mini_app_assignments"("attempt_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_assignments_schedule_run_key_workflow_id_mini_app__key" ON "mini_app_assignments"("schedule_run_key", "workflow_id", "mini_app_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_learning_state_workflow_id_subject_type_subject_id_key" ON "member_learning_state"("workflow_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_generation_charges_charge_id_key" ON "mini_app_generation_charges"("charge_id");

-- CreateIndex
CREATE INDEX "mini_app_generation_charges_status_idx" ON "mini_app_generation_charges"("status");

-- CreateIndex
CREATE INDEX "mini_app_generation_charges_status_shortfall_checked_at_idx" ON "mini_app_generation_charges"("status", "shortfall_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "mini_app_generation_charges_payload_id_attempt_id_key" ON "mini_app_generation_charges"("payload_id", "attempt_id");

-- CreateIndex
CREATE INDEX "voice_quiz_rounds_agent_id_member_key_created_at_idx" ON "voice_quiz_rounds"("agent_id", "member_key", "created_at");

-- CreateIndex
CREATE INDEX "voice_quiz_rounds_call_connection_id_idx" ON "voice_quiz_rounds"("call_connection_id");

-- CreateIndex
CREATE INDEX "voice_quiz_lessons_agent_id_program_id_idx" ON "voice_quiz_lessons"("agent_id", "program_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_lessons_agent_id_program_id_lesson_no_locale_key" ON "voice_quiz_lessons"("agent_id", "program_id", "lesson_no", "locale");

-- CreateIndex
CREATE INDEX "voice_quiz_progress_agent_id_program_id_member_key_idx" ON "voice_quiz_progress"("agent_id", "program_id", "member_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_progress_agent_id_program_id_member_key_round_no_key" ON "voice_quiz_progress"("agent_id", "program_id", "member_key", "round_no");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_withdrawals_agent_id_member_key_key" ON "voice_quiz_withdrawals"("agent_id", "member_key");

-- CreateIndex
CREATE INDEX "voice_quiz_consents_agent_id_program_id_member_key_idx" ON "voice_quiz_consents"("agent_id", "program_id", "member_key");

-- CreateIndex
CREATE INDEX "voice_quiz_consents_exported_at_created_at_idx" ON "voice_quiz_consents"("exported_at", "created_at");

-- CreateIndex
CREATE INDEX "voice_quiz_consent_exports_status_purge_at_idx" ON "voice_quiz_consent_exports"("status", "purge_at");

-- CreateIndex
CREATE INDEX "voice_quiz_consent_exports_purged_at_notify_stage_idx" ON "voice_quiz_consent_exports"("purged_at", "notify_stage");

-- CreateIndex
CREATE INDEX "voice_quiz_consent_exports_user_id_created_at_idx" ON "voice_quiz_consent_exports"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_quiz_reservations_checked_at_idx" ON "voice_quiz_reservations"("checked_at");

-- CreateIndex
CREATE INDEX "voice_quiz_reservations_agent_id_program_id_group_key_idx" ON "voice_quiz_reservations"("agent_id", "program_id", "group_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_reservations_agent_id_program_id_member_key_key" ON "voice_quiz_reservations"("agent_id", "program_id", "member_key");

-- CreateIndex
CREATE INDEX "voice_quiz_dial_claims_agent_id_program_id_group_key_call_d_idx" ON "voice_quiz_dial_claims"("agent_id", "program_id", "group_key", "call_date");

-- CreateIndex
CREATE INDEX "voice_quiz_dial_claims_agent_id_program_id_member_key_idx" ON "voice_quiz_dial_claims"("agent_id", "program_id", "member_key");

-- CreateIndex
CREATE INDEX "voice_quiz_dial_claims_call_date_idx" ON "voice_quiz_dial_claims"("call_date");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_dial_claims_agent_id_program_id_call_date_member_key" ON "voice_quiz_dial_claims"("agent_id", "program_id", "call_date", "member_key", "round_no");

-- CreateIndex
CREATE INDEX "voice_quiz_member_actions_agent_id_program_id_member_key_st_idx" ON "voice_quiz_member_actions"("agent_id", "program_id", "member_key", "status");

-- CreateIndex
CREATE INDEX "voice_quiz_member_actions_status_created_at_idx" ON "voice_quiz_member_actions"("status", "created_at");

-- CreateIndex
CREATE INDEX "voice_quiz_member_actions_status_swept_at_idx" ON "voice_quiz_member_actions"("status", "swept_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_member_actions_agent_id_program_id_member_key_se_key" ON "voice_quiz_member_actions"("agent_id", "program_id", "member_key", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "voice_quiz_member_actions_agent_id_program_id_member_key_ac_key" ON "voice_quiz_member_actions"("agent_id", "program_id", "member_key", "action_key");

-- CreateIndex
CREATE INDEX "vat_fx_rate_currency_valid_for_idx" ON "vat_fx_rate"("currency", "valid_for");

-- CreateIndex
CREATE UNIQUE INDEX "vat_fx_rate_kind_valid_for_currency_version_key" ON "vat_fx_rate"("kind", "valid_for", "currency", "version");

-- CreateIndex
CREATE UNIQUE INDEX "vat_fx_rate_manual_user_id_date_currency_key" ON "vat_fx_rate_manual"("user_id", "date", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "vat_fx_rate_manual_user_id_export_key_key" ON "vat_fx_rate_manual"("user_id", "export_key");

-- CreateIndex
CREATE UNIQUE INDEX "work_project_workflow_id_key" ON "work_project"("workflow_id");

-- CreateIndex
CREATE INDEX "work_project_user_id_idx" ON "work_project"("user_id");

-- CreateIndex
CREATE INDEX "work_project_agent_id_idx" ON "work_project"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_project_id_user_id_key" ON "work_project"("id", "user_id");

-- CreateIndex
CREATE INDEX "project_reference_to_project_id_idx" ON "project_reference"("to_project_id");

-- CreateIndex
CREATE INDEX "project_reference_user_id_idx" ON "project_reference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_reference_from_project_id_to_project_id_key" ON "project_reference"("from_project_id", "to_project_id");

-- CreateIndex
CREATE INDEX "work_task_project_id_idx" ON "work_task"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_task_id_project_id_user_id_key" ON "work_task"("id", "project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_row_key_project_id_template_family_key_hash_key" ON "sheet_row_key"("project_id", "template_family", "key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_row_key_row_id_template_family_key" ON "sheet_row_key"("row_id", "template_family");

-- CreateIndex
CREATE INDEX "sheet_row_pair_to_row_id_idx" ON "sheet_row_pair"("to_row_id");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_row_pair_from_row_id_to_row_id_kind_key" ON "sheet_row_pair"("from_row_id", "to_row_id", "kind");

-- CreateIndex
CREATE INDEX "work_note_project_id_task_id_idx" ON "work_note"("project_id", "task_id");

-- CreateIndex
CREATE INDEX "work_message_project_id_task_id_created_at_idx" ON "work_message"("project_id", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "work_event_user_id_created_at_idx" ON "work_event"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "work_event_project_id_created_at_idx" ON "work_event"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_submission_task_id_number_key" ON "work_submission"("task_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "work_submission_id_project_id_user_id_key" ON "work_submission"("id", "project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_file_project_id_sha256_key" ON "work_file"("project_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "work_file_id_project_id_user_id_key" ON "work_file"("id", "project_id", "user_id");

-- CreateIndex
CREATE INDEX "work_task_file_file_id_idx" ON "work_task_file"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_task_file_task_id_file_id_key" ON "work_task_file"("task_id", "file_id");

-- CreateIndex
CREATE INDEX "work_submission_source_source_task_id_idx" ON "work_submission_source"("source_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_submission_source_submission_id_source_task_id_key" ON "work_submission_source"("submission_id", "source_task_id");

-- CreateIndex
CREATE INDEX "work_submission_file_file_id_idx" ON "work_submission_file"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_submission_file_submission_id_file_id_key" ON "work_submission_file"("submission_id", "file_id");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_zki_id_fkey" FOREIGN KEY ("zki_id") REFERENCES "zki"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_token" ADD CONSTRAINT "mcp_access_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_deploy_request" ADD CONSTRAINT "mcp_deploy_request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_refresh_token" ADD CONSTRAINT "app_refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_refresh_token" ADD CONSTRAINT "app_refresh_token_agent_member_id_fkey" FOREIGN KEY ("agent_member_id") REFERENCES "agent_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_config" ADD CONSTRAINT "analytics_config_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_providers" ADD CONSTRAINT "rag_providers_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_stores" ADD CONSTRAINT "rag_stores_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booster_purchases" ADD CONSTRAINT "booster_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_info" ADD CONSTRAINT "billing_info_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_ledger" ADD CONSTRAINT "cpa_ledger_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_ledger" ADD CONSTRAINT "cpa_ledger_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_plan_change_schedule" ADD CONSTRAINT "invoice_plan_change_schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_usage_log" ADD CONSTRAINT "cpa_usage_log_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_member_passkeys" ADD CONSTRAINT "agent_member_passkeys_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "agent_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_member_invitations" ADD CONSTRAINT "agent_member_invitations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage" ADD CONSTRAINT "storage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage" ADD CONSTRAINT "storage_rag_space_id_fkey" FOREIGN KEY ("rag_space_id") REFERENCES "rag_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_spaces" ADD CONSTRAINT "rag_spaces_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anonymization_requests" ADD CONSTRAINT "anonymization_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_media" ADD CONSTRAINT "blog_media_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sheets" ADD CONSTRAINT "data_sheets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sheets" ADD CONSTRAINT "data_sheets_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sheet_rows" ADD CONSTRAINT "data_sheet_rows_sheet_id_kind_fkey" FOREIGN KEY ("sheet_id", "kind") REFERENCES "data_sheets"("id", "kind") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sheet_rows" ADD CONSTRAINT "data_sheet_rows_sheet_id_project_id_user_id_fkey" FOREIGN KEY ("sheet_id", "project_id", "user_id") REFERENCES "data_sheets"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_groups" ADD CONSTRAINT "workflow_groups_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_group_items" ADD CONSTRAINT "workflow_group_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "workflow_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_group_items" ADD CONSTRAINT "workflow_group_items_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_group_data_sheets" ADD CONSTRAINT "workflow_group_data_sheets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "workflow_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_group_data_sheets" ADD CONSTRAINT "workflow_group_data_sheets_sheet_id_sheet_kind_fkey" FOREIGN KEY ("sheet_id", "sheet_kind") REFERENCES "data_sheets"("id", "kind") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_connections" ADD CONSTRAINT "workflow_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_connections" ADD CONSTRAINT "workflow_connections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_calendar_accounts" ADD CONSTRAINT "workflow_calendar_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "workflow_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_visitor_contacts" ADD CONSTRAINT "web_visitor_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_index" ADD CONSTRAINT "booking_index_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "wf_template_category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_ai_assistant_messages" ADD CONSTRAINT "workflow_ai_assistant_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workflow_ai_assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_channels" ADD CONSTRAINT "bot_channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_channels" ADD CONSTRAINT "bot_channels_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_phone_numbers" ADD CONSTRAINT "call_phone_numbers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_phone_numbers" ADD CONSTRAINT "call_phone_numbers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_phone_numbers" ADD CONSTRAINT "call_phone_numbers_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "workflow_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_voice_sessions" ADD CONSTRAINT "web_voice_sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_cost_metrics" ADD CONSTRAINT "voice_cost_metrics_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_payloads" ADD CONSTRAINT "mini_app_payloads_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "mini_app_assignments"("assignment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_payloads" ADD CONSTRAINT "mini_app_payloads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_payloads" ADD CONSTRAINT "mini_app_payloads_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_payloads" ADD CONSTRAINT "mini_app_payloads_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_push_tokens" ADD CONSTRAINT "app_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_push_tokens" ADD CONSTRAINT "app_push_tokens_agent_member_id_fkey" FOREIGN KEY ("agent_member_id") REFERENCES "agent_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_push_logs" ADD CONSTRAINT "mini_app_push_logs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "mini_app_assignments"("assignment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_push_logs" ADD CONSTRAINT "mini_app_push_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "app_push_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_results" ADD CONSTRAINT "mini_app_results_payload_id_fkey" FOREIGN KEY ("payload_id") REFERENCES "mini_app_payloads"("payload_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_assignments" ADD CONSTRAINT "mini_app_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_assignments" ADD CONSTRAINT "mini_app_assignments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_assignments" ADD CONSTRAINT "mini_app_assignments_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_learning_state" ADD CONSTRAINT "member_learning_state_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_app_generation_charges" ADD CONSTRAINT "mini_app_generation_charges_payload_id_fkey" FOREIGN KEY ("payload_id") REFERENCES "mini_app_payloads"("payload_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_quiz_lessons" ADD CONSTRAINT "voice_quiz_lessons_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_quiz_consents" ADD CONSTRAINT "voice_quiz_consents_agent_id_notice_hash_fkey" FOREIGN KEY ("agent_id", "notice_hash") REFERENCES "voice_quiz_consent_notices"("agent_id", "hash") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vat_fx_rate_manual" ADD CONSTRAINT "vat_fx_rate_manual_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("workflowId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reference" ADD CONSTRAINT "project_reference_from_project_id_user_id_fkey" FOREIGN KEY ("from_project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reference" ADD CONSTRAINT "project_reference_to_project_id_user_id_fkey" FOREIGN KEY ("to_project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row_key" ADD CONSTRAINT "sheet_row_key_row_id_project_id_user_id_fkey" FOREIGN KEY ("row_id", "project_id", "user_id") REFERENCES "data_sheet_rows"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row_pair" ADD CONSTRAINT "sheet_row_pair_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row_pair" ADD CONSTRAINT "sheet_row_pair_from_row_id_project_id_user_id_fkey" FOREIGN KEY ("from_row_id", "project_id", "user_id") REFERENCES "data_sheet_rows"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row_pair" ADD CONSTRAINT "sheet_row_pair_to_row_id_project_id_user_id_fkey" FOREIGN KEY ("to_row_id", "project_id", "user_id") REFERENCES "data_sheet_rows"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_note" ADD CONSTRAINT "work_note_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_note" ADD CONSTRAINT "work_note_task_id_project_id_user_id_fkey" FOREIGN KEY ("task_id", "project_id", "user_id") REFERENCES "work_task"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_message" ADD CONSTRAINT "work_message_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_message" ADD CONSTRAINT "work_message_task_id_project_id_user_id_fkey" FOREIGN KEY ("task_id", "project_id", "user_id") REFERENCES "work_task"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_event" ADD CONSTRAINT "work_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submission" ADD CONSTRAINT "work_submission_task_id_project_id_user_id_fkey" FOREIGN KEY ("task_id", "project_id", "user_id") REFERENCES "work_task"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_file" ADD CONSTRAINT "work_file_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "work_project"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_file" ADD CONSTRAINT "work_file_parent_file_id_project_id_user_id_fkey" FOREIGN KEY ("parent_file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_file" ADD CONSTRAINT "work_task_file_task_id_project_id_user_id_fkey" FOREIGN KEY ("task_id", "project_id", "user_id") REFERENCES "work_task"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_file" ADD CONSTRAINT "work_task_file_file_id_project_id_user_id_fkey" FOREIGN KEY ("file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submission_source" ADD CONSTRAINT "work_submission_source_submission_id_project_id_user_id_fkey" FOREIGN KEY ("submission_id", "project_id", "user_id") REFERENCES "work_submission"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submission_file" ADD CONSTRAINT "work_submission_file_submission_id_project_id_user_id_fkey" FOREIGN KEY ("submission_id", "project_id", "user_id") REFERENCES "work_submission"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submission_file" ADD CONSTRAINT "work_submission_file_file_id_project_id_user_id_fkey" FOREIGN KEY ("file_id", "project_id", "user_id") REFERENCES "work_file"("id", "project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== app_push_tokens_owner_xor.sql =====
--
--   npx prisma db execute --file prisma/migrations/manual/app_push_tokens_owner_xor.sql --schema=prisma/schema.prisma

ALTER TABLE "app_push_tokens" DROP CONSTRAINT IF EXISTS app_push_tokens_owner_xor;
ALTER TABLE "app_push_tokens" ADD CONSTRAINT app_push_tokens_owner_xor
  CHECK (("user_id" IS NULL) <> ("agent_member_id" IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS app_push_tokens_device_active_uniq
ON "app_push_tokens" ("device_id")
WHERE enabled = true;

-- ===== app_refresh_token_owner_xor.sql =====
--
--   npx prisma db execute --file prisma/migrations/manual/app_refresh_token_owner_xor.sql --schema=prisma/schema.prisma

ALTER TABLE "app_refresh_token" DROP CONSTRAINT IF EXISTS app_refresh_token_owner_xor;
ALTER TABLE "app_refresh_token" ADD CONSTRAINT app_refresh_token_owner_xor
  CHECK (("user_id" IS NULL) <> ("agent_member_id" IS NULL));

-- ===== rag_spaces_default_uniq.sql =====
--
--   SELECT "agentId", count(*) FROM "rag_spaces" WHERE "is_default" = true
--   GROUP BY 1 HAVING count(*) > 1;
--

CREATE UNIQUE INDEX IF NOT EXISTS rag_spaces_default_uniq
ON "rag_spaces" ("agentId")
WHERE "is_default" = true;

-- ===== rag_spaces_name_ci_uniq.sql =====
-- docs/source/plan.md / rag_space_review.md R4
--
--   SELECT "agentId", lower("name"), count(*) FROM "rag_spaces"
--   GROUP BY 1,2 HAVING count(*) > 1;
--

CREATE UNIQUE INDEX IF NOT EXISTS rag_spaces_name_ci_uniq
ON "rag_spaces" ("agentId", lower("name"));

-- ===== storage_processing_uniq.sql =====
--
--   SELECT "agentId", "sourceUrl", count(*)
--   FROM "storage"
--   WHERE status = 'processing'
--   GROUP BY 1,2
--   HAVING count(*) > 1;
--
--   npx prisma db execute --file prisma/migrations/manual/storage_processing_uniq.sql --schema=prisma/schema.prisma

CREATE UNIQUE INDEX IF NOT EXISTS storage_processing_uniq
ON "storage" ("agentId", "sourceUrl")
WHERE status = 'processing';

-- ===== user_email_lower_idx.sql =====
--
--

CREATE INDEX IF NOT EXISTS user_email_lower_idx
ON "user" (lower(email));

-- ===== voice_quiz_dial_claims_check.sql =====
--
--
ALTER TABLE "voice_quiz_dial_claims" DROP CONSTRAINT IF EXISTS voice_quiz_dial_claims_status;
ALTER TABLE "voice_quiz_dial_claims" ADD CONSTRAINT voice_quiz_dial_claims_status
  CHECK ("status" IN ('none', 'dialing', 'dialed'));

ALTER TABLE "voice_quiz_dial_claims" DROP CONSTRAINT IF EXISTS voice_quiz_dial_claims_date_shape;
ALTER TABLE "voice_quiz_dial_claims" ADD CONSTRAINT voice_quiz_dial_claims_date_shape
  CHECK ("call_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE "voice_quiz_dial_claims" DROP CONSTRAINT IF EXISTS voice_quiz_dial_claims_round_positive;
ALTER TABLE "voice_quiz_dial_claims" ADD CONSTRAINT voice_quiz_dial_claims_round_positive
  CHECK ("round_no" >= 1);

ALTER TABLE "voice_quiz_dial_claims" DROP CONSTRAINT IF EXISTS voice_quiz_dial_claims_group_not_blank;
ALTER TABLE "voice_quiz_dial_claims" ADD CONSTRAINT voice_quiz_dial_claims_group_not_blank
  CHECK (btrim("group_key") <> '');

-- ===== voice_quiz_lessons_locale.sql =====
--
--
--

DO $$
DECLARE
  has_lang   boolean;
  has_locale boolean;
  left_over  int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'voice_quiz_lessons' AND column_name = 'lang') INTO has_lang;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'voice_quiz_lessons' AND column_name = 'locale') INTO has_locale;

  IF NOT has_lang AND NOT has_locale THEN
    RETURN;
  END IF;

  IF has_lang AND NOT has_locale THEN
    ALTER TABLE voice_quiz_lessons RENAME COLUMN lang TO locale;
    ALTER TABLE voice_quiz_lessons ALTER COLUMN locale TYPE varchar(16);
    ALTER TABLE voice_quiz_lessons ALTER COLUMN locale SET DEFAULT 'ko-KR';
    has_lang := false;
    has_locale := true;
  ELSIF has_lang AND has_locale THEN
    --
    IF EXISTS (SELECT 1 FROM voice_quiz_lessons WHERE locale IS DISTINCT FROM 'ko-KR') THEN
      RAISE EXCEPTION
        'voice_quiz_lessons: `lang` 과 `locale` 이 둘 다 있고 그 사이에 새 값이 쓰였다 — 어느 쪽이 정본인지 알 수 없다. 이 SQL 은 `prisma db push` «전»에 돌려야 한다. 이미 밀었다면 사람이 행마다 보고 `lang` 칸을 지운 뒤 다시 돌려라.';
    END IF;
    UPDATE voice_quiz_lessons
       SET locale = CASE lang
                      WHEN 'en' THEN 'en-US' WHEN 'de' THEN 'de-CH'
                      WHEN 'fr' THEN 'fr-CH' WHEN 'ko' THEN 'ko-KR'
                      ELSE lang
                    END
     WHERE lang IS NOT NULL AND lang <> '';
    ALTER TABLE voice_quiz_lessons DROP COLUMN lang;
    has_lang := false;
  END IF;

  UPDATE voice_quiz_lessons
     SET locale = CASE locale
                    WHEN 'en' THEN 'en-US' WHEN 'de' THEN 'de-CH'
                    WHEN 'fr' THEN 'fr-CH' WHEN 'ko' THEN 'ko-KR'
                    ELSE locale
                  END
   WHERE locale IN ('en', 'de', 'fr', 'ko');

  SELECT count(*) INTO left_over FROM voice_quiz_lessons
   WHERE locale NOT IN ('de-CH', 'de-DE', 'fr-CH', 'fr-FR', 'en-US', 'en-GB', 'ko-KR');
  IF left_over > 0 THEN
    RAISE EXCEPTION
      'voice_quiz_lessons: 아는 로케일이 아닌 행이 % 개 남았다 — 같은 회차에 갈래·로케일이 겹쳤거나, 목록 밖 값이 들어 있다. 사람이 보고 정한 뒤 다시 돌려라.',
      left_over;
  END IF;
END $$;

-- ===== voice_quiz_member_actions_check.sql =====
--
--
--
--

-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_kind;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_kind
  CHECK ("kind" IN ('enroll', 'move', 'resume', 'stop', 'erase'));

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_claim_group;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_claim_group
  CHECK ("kind" NOT IN ('enroll', 'move', 'resume') OR ("target_group" IS NOT NULL AND btrim("target_group") <> ''));

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_release_group;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_release_group
  CHECK ("kind" NOT IN ('stop', 'erase') OR "target_group" IS NULL);

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_status;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_status
  CHECK ("status" IN ('pending', 'done', 'blocked'));

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_blocked_erase_only;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_blocked_erase_only
  CHECK ("status" <> 'blocked' OR "kind" = 'erase');

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_seq_positive;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_seq_positive
  CHECK ("seq" >= 1);

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_release_source;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_release_source
  CHECK ("kind" NOT IN ('stop', 'erase') OR "source_group" IS NULL);

ALTER TABLE "voice_quiz_member_actions" DROP CONSTRAINT IF EXISTS voice_quiz_member_actions_source_not_blank;
ALTER TABLE "voice_quiz_member_actions" ADD CONSTRAINT voice_quiz_member_actions_source_not_blank
  CHECK ("source_group" IS NULL OR btrim("source_group") <> '');

-- ===== voice_quiz_reservations_check.sql =====
--
--
ALTER TABLE "voice_quiz_reservations" DROP CONSTRAINT IF EXISTS voice_quiz_reservations_group_not_blank;
ALTER TABLE "voice_quiz_reservations" ADD CONSTRAINT voice_quiz_reservations_group_not_blank
  CHECK (btrim("group_key") <> '');

-- ===== voice_quiz_rounds_open_uniq.sql =====
--
--

CREATE UNIQUE INDEX IF NOT EXISTS voice_quiz_rounds_open_uniq_v2
ON "voice_quiz_rounds" ("agent_id", "member_key")
WHERE "status" IN ('generating', 'ready', 'asked', 'graded', 'settling', 'paying');

DROP INDEX IF EXISTS voice_quiz_rounds_open_uniq;

-- ===== work_module_bank_import.sql =====
UPDATE work_project
SET modules = CASE
  WHEN 'bank.import' = ANY(modules) THEN array_remove(modules, 'bank.ubs-import')
  ELSE array_replace(modules, 'bank.ubs-import', 'bank.import')
END
WHERE 'bank.ubs-import' = ANY(modules);

-- ===== work_sheets.sql =====
--
--

UPDATE "data_sheets" s SET "user_id" = a."userId"
  FROM "agents" a
  WHERE s."agentId" = a."agentId" AND s."user_id" IS NULL;

ALTER TABLE "data_sheets" DROP CONSTRAINT IF EXISTS data_sheets_kind_owner;
ALTER TABLE "data_sheets" ADD CONSTRAINT data_sheets_kind_owner CHECK (
  "user_id" IS NOT NULL AND (
    ("kind" = 'agent' AND "agentId" IS NOT NULL AND "project_id" IS NULL AND "template" IS NULL AND "template_family" IS NULL)
    OR ("kind" = 'project' AND "agentId" IS NULL AND "project_id" IS NOT NULL)
  )
);
ALTER TABLE "data_sheets" DROP CONSTRAINT IF EXISTS data_sheets_template_family;
ALTER TABLE "data_sheets" ADD CONSTRAINT data_sheets_template_family CHECK (("template" IS NULL) = ("template_family" IS NULL));

ALTER TABLE "data_sheet_rows" DROP CONSTRAINT IF EXISTS data_sheet_rows_kind_owner;
ALTER TABLE "data_sheet_rows" ADD CONSTRAINT data_sheet_rows_kind_owner CHECK (
  ("kind" = 'agent' AND "project_id" IS NULL AND "user_id" IS NULL AND "sealed" IS NULL AND "confirmed" IS NULL)
  OR ("kind" = 'project' AND "project_id" IS NOT NULL AND "user_id" IS NOT NULL)
);

ALTER TABLE "workflow_group_data_sheets" DROP CONSTRAINT IF EXISTS workflow_group_data_sheets_agent_only;
ALTER TABLE "workflow_group_data_sheets" ADD CONSTRAINT workflow_group_data_sheets_agent_only CHECK ("sheet_kind" = 'agent');

ALTER TABLE "work_project" DROP CONSTRAINT IF EXISTS work_project_status;
ALTER TABLE "work_project" ADD CONSTRAINT work_project_status CHECK ("status" IN ('active', 'archived'));
ALTER TABLE "work_project" DROP CONSTRAINT IF EXISTS work_project_kind_not_blank;
ALTER TABLE "work_project" ADD CONSTRAINT work_project_kind_not_blank CHECK (btrim("kind") <> '');

ALTER TABLE "work_task" DROP CONSTRAINT IF EXISTS work_task_status;
ALTER TABLE "work_task" ADD CONSTRAINT work_task_status CHECK ("status" IN ('open', 'submitted'));
ALTER TABLE "work_task" DROP CONSTRAINT IF EXISTS work_task_period;
ALTER TABLE "work_task" ADD CONSTRAINT work_task_period CHECK (
  ("period_start" IS NULL AND "period_end" IS NULL)
  OR ("period_start" IS NOT NULL AND "period_end" IS NOT NULL AND "period_start" <= "period_end")
);

ALTER TABLE "sheet_row_pair" DROP CONSTRAINT IF EXISTS sheet_row_pair_not_self;
ALTER TABLE "sheet_row_pair" ADD CONSTRAINT sheet_row_pair_not_self CHECK ("from_row_id" <> "to_row_id");

ALTER TABLE "work_submission" DROP CONSTRAINT IF EXISTS work_submission_number_positive;
ALTER TABLE "work_submission" ADD CONSTRAINT work_submission_number_positive CHECK ("number" > 0);
ALTER TABLE "work_file" DROP CONSTRAINT IF EXISTS work_file_shape;
ALTER TABLE "work_file" ADD CONSTRAINT work_file_shape CHECK ("size_bytes" > 0 AND "sha256" ~ '^[0-9a-f]{64}$');

UPDATE "work_project" SET "workflow_linked_at" = "created_at" WHERE "workflow_id" IS NOT NULL AND "workflow_linked_at" IS NULL;

ALTER TABLE "project_reference" DROP CONSTRAINT IF EXISTS project_reference_not_self;
ALTER TABLE "project_reference" ADD CONSTRAINT project_reference_not_self CHECK ("from_project_id" <> "to_project_id");
ALTER TABLE "project_reference" DROP CONSTRAINT IF EXISTS project_reference_sheets_not_empty;
ALTER TABLE "project_reference" ADD CONSTRAINT project_reference_sheets_not_empty CHECK (cardinality("sheets") > 0);

ALTER TABLE "work_note" DROP CONSTRAINT IF EXISTS work_note_kind;
ALTER TABLE "work_note" ADD CONSTRAINT work_note_kind CHECK ("kind" IN ('conclusion', 'todo', 'source'));

ALTER TABLE "work_note" DROP CONSTRAINT IF EXISTS work_note_status;
ALTER TABLE "work_note" ADD CONSTRAINT work_note_status CHECK ("status" IN ('accepted', 'proposed'));

ALTER TABLE "work_message" DROP CONSTRAINT IF EXISTS work_message_role;
ALTER TABLE "work_message" ADD CONSTRAINT work_message_role CHECK ("role" IN ('user', 'assistant'));

-- ===== work_tx_evidence.sql =====
UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"evidence","type":"string"}]'::jsonb)::text
WHERE template = 'vat.transactions@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"evidence"}]'::jsonb);

UPDATE data_sheets
SET schema = jsonb_set(schema::jsonb, '{columns}', (schema::jsonb -> 'columns') || '[{"name":"receiptFileId","type":"string"}]'::jsonb)::text
WHERE template = 'vat.transactions@1'
  AND NOT ((schema::jsonb -> 'columns') @> '[{"name":"receiptFileId"}]'::jsonb);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_sheet_rows_confirmed_by_chk' AND conrelid = 'data_sheet_rows'::regclass) THEN
    ALTER TABLE data_sheet_rows ADD CONSTRAINT data_sheet_rows_confirmed_by_chk CHECK (confirmed_by IS NULL OR confirmed IS TRUE);
  END IF;
END $$;
