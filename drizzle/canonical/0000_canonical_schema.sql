-- weyne:migration compatibility=expand previous-app-compatible=true
-- Generated from src/lib/db/schema/canonical.ts. Do not hand-edit declarations here.
CREATE TYPE "public"."actor_role" AS ENUM('admin', 'representative', 'read_only', 'system');--> statement-breakpoint
CREATE TYPE "public"."commission_scope" AS ENUM('industry_default', 'product_override');--> statement-breakpoint
CREATE TYPE "public"."commission_source" AS ENUM('product_override', 'industry_default', 'none');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('quote', 'order');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'confirmed', 'invoiced', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."price_list_key" AS ENUM('PRICE_1', 'PRICE_2', 'PRICE_3', 'PRICE_4');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('price_list', 'manual_override');--> statement-breakpoint
CREATE TYPE "public"."product_asset_kind" AS ENUM('image', 'technical_sheet', 'safety_sheet');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'representative', 'read_only');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_uq" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "attachments_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "attachments_size_ck" CHECK ("attachments"."size_bytes" > 0),
	CONSTRAINT "attachments_archive_actor_ck" CHECK (("attachments"."archived_at" IS NULL) = ("attachments"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "actor_role" NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "audit_events_action_ck" CHECK (btrim("audit_events"."action") <> ''),
	CONSTRAINT "audit_events_entity_type_ck" CHECK (btrim("audit_events"."entity_type") <> ''),
	CONSTRAINT "audit_events_actor_ck" CHECK (("audit_events"."actor_role" = 'system' AND "audit_events"."actor_user_id" IS NULL)
        OR ("audit_events"."actor_role" <> 'system' AND "audit_events"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "audit_events_metadata_json_ck" CHECK (jsonb_typeof("audit_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "carriers_name_ck" CHECK (btrim("carriers"."name") <> ''),
	CONSTRAINT "carriers_archive_actor_ck" CHECK (("carriers"."archived_at" IS NULL) = ("carriers"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "commission_scope" NOT NULL,
	"industry_id" uuid,
	"product_id" uuid,
	"rate" numeric(9, 6) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"ended_by_user_id" uuid,
	CONSTRAINT "commission_rules_rate_ck" CHECK ("commission_rules"."rate" BETWEEN 0 AND 100),
	CONSTRAINT "commission_rules_target_ck" CHECK (("commission_rules"."scope" = 'industry_default' AND "commission_rules"."industry_id" IS NOT NULL AND "commission_rules"."product_id" IS NULL)
        OR ("commission_rules"."scope" = 'product_override' AND "commission_rules"."product_id" IS NOT NULL AND "commission_rules"."industry_id" IS NULL)),
	CONSTRAINT "commission_rules_validity_ck" CHECK (("commission_rules"."valid_to" IS NULL OR "commission_rules"."valid_to" > "commission_rules"."valid_from")
        AND (("commission_rules"."valid_to" IS NULL) = ("commission_rules"."ended_by_user_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"tax_id" text,
	"state_registration" text,
	"street_address" text,
	"postal_code" text,
	"city" text,
	"state" char(2),
	"phone" text,
	"whatsapp" text,
	"email" text,
	"contact_name" text,
	"segment" text,
	"credit_limit" numeric(19, 2),
	"currency_code" char(3),
	"notes" text,
	"responsible_representative_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "customers_legal_name_ck" CHECK (btrim("customers"."legal_name") <> ''),
	CONSTRAINT "customers_credit_limit_ck" CHECK ("customers"."credit_limit" IS NULL OR "customers"."credit_limit" >= 0),
	CONSTRAINT "customers_credit_currency_ck" CHECK (("customers"."credit_limit" IS NULL AND "customers"."currency_code" IS NULL)
        OR ("customers"."credit_limit" IS NOT NULL AND "customers"."currency_code" = 'BRL')),
	CONSTRAINT "customers_archive_actor_ck" CHECK (("customers"."archived_at" IS NULL) = ("customers"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"document_type" "document_type" NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_pk" PRIMARY KEY("document_type","year"),
	CONSTRAINT "document_sequences_year_ck" CHECK ("document_sequences"."year" BETWEEN 2000 AND 9999),
	CONSTRAINT "document_sequences_next_value_ck" CHECK ("document_sequences"."next_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_type" text NOT NULL,
	"command_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"status" "idempotency_status" NOT NULL,
	"result_entity_type" text,
	"result_entity_id" uuid,
	"response_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_command_uq" UNIQUE("command_type","command_id"),
	CONSTRAINT "idempotency_records_hash_ck" CHECK (btrim("idempotency_records"."payload_hash") <> ''),
	CONSTRAINT "idempotency_records_result_ck" CHECK (("idempotency_records"."status" = 'in_progress' AND "idempotency_records"."completed_at" IS NULL
          AND "idempotency_records"."result_entity_type" IS NULL AND "idempotency_records"."result_entity_id" IS NULL
          AND "idempotency_records"."response_snapshot" IS NULL)
        OR ("idempotency_records"."status" = 'completed' AND "idempotency_records"."completed_at" IS NOT NULL
          AND "idempotency_records"."result_entity_type" IS NOT NULL AND "idempotency_records"."result_entity_id" IS NOT NULL
          AND "idempotency_records"."response_snapshot" IS NOT NULL)),
	CONSTRAINT "idempotency_records_response_json_ck" CHECK ("idempotency_records"."response_snapshot" IS NULL OR jsonb_typeof("idempotency_records"."response_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"tax_id" text,
	"address" text,
	"notes" text,
	"brand_name" text,
	"logo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "industries_legal_name_ck" CHECK (btrim("industries"."legal_name") <> ''),
	CONSTRAINT "industries_archive_actor_ck" CHECK (("industries"."archived_at" IS NULL) = ("industries"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "actor_role" NOT NULL,
	"command_id" uuid NOT NULL,
	"reason" text,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "order_events_type_ck" CHECK (btrim("order_events"."event_type") <> ''),
	CONSTRAINT "order_events_actor_ck" CHECK (("order_events"."actor_role" = 'system' AND "order_events"."actor_user_id" IS NULL)
        OR ("order_events"."actor_role" <> 'system' AND "order_events"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "order_events_metadata_ck" CHECK (jsonb_typeof("order_events"."metadata") = 'object'
        AND jsonb_typeof("order_events"."metadata"->'version') = 'number'
        AND ("order_events"."metadata"->>'version')::numeric > 0
        AND mod(("order_events"."metadata"->>'version')::numeric, 1) = 0)
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"source_quote_line_id" uuid NOT NULL,
	"quote_line_position_snapshot" integer NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"product_price_id" uuid NOT NULL,
	"price_source" "price_source" NOT NULL,
	"product_code_snapshot" text NOT NULL,
	"product_description_snapshot" text NOT NULL,
	"manufacturer_code_snapshot" text,
	"brand_snapshot" text,
	"packaging_snapshot" text,
	"unit_snapshot" text NOT NULL,
	"industry_id_snapshot" uuid NOT NULL,
	"industry_name_snapshot" text NOT NULL,
	"price_list_id_snapshot" uuid NOT NULL,
	"price_list_key_snapshot" "price_list_key" NOT NULL,
	"price_list_name_snapshot" text NOT NULL,
	"unit_price_snapshot" numeric(19, 6) NOT NULL,
	"currency_code" char(3) DEFAULT 'BRL' NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"line_discount_rate" numeric(9, 6) NOT NULL,
	"gross_amount_snapshot" numeric(19, 2) NOT NULL,
	"line_discount_amount_snapshot" numeric(19, 2) NOT NULL,
	"net_after_line_discount_amount_snapshot" numeric(19, 2) NOT NULL,
	"overall_discount_allocation_amount_snapshot" numeric(19, 2) NOT NULL,
	"net_merchandise_amount_snapshot" numeric(19, 2) NOT NULL,
	"taxes_snapshot" jsonb NOT NULL,
	"ipi_rate_snapshot" numeric(9, 6),
	"icms_rate_snapshot" numeric(9, 6),
	"pis_rate_snapshot" numeric(9, 6),
	"cofins_rate_snapshot" numeric(9, 6),
	"commission_rule_id" uuid,
	"commission_source_snapshot" "commission_source" NOT NULL,
	"commission_rate_snapshot" numeric(9, 6),
	"commission_basis_amount_snapshot" numeric(19, 2) NOT NULL,
	"commission_value_amount_snapshot" numeric(19, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "order_lines_order_position_uq" UNIQUE("order_id","position"),
	CONSTRAINT "order_lines_source_quote_line_uq" UNIQUE("source_quote_line_id"),
	CONSTRAINT "order_lines_quote_position_ck" CHECK ("order_lines"."quote_line_position_snapshot" > 0),
	CONSTRAINT "order_lines_position_ck" CHECK ("order_lines"."position" > 0),
	CONSTRAINT "order_lines_quantity_ck" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_currency_ck" CHECK ("order_lines"."currency_code" = 'BRL'),
	CONSTRAINT "order_lines_rates_ck" CHECK ("order_lines"."line_discount_rate" BETWEEN 0 AND 100
      AND ("order_lines"."ipi_rate_snapshot" IS NULL OR "order_lines"."ipi_rate_snapshot" BETWEEN 0 AND 100)
      AND ("order_lines"."icms_rate_snapshot" IS NULL OR "order_lines"."icms_rate_snapshot" BETWEEN 0 AND 100)
      AND ("order_lines"."pis_rate_snapshot" IS NULL OR "order_lines"."pis_rate_snapshot" BETWEEN 0 AND 100)
      AND ("order_lines"."cofins_rate_snapshot" IS NULL OR "order_lines"."cofins_rate_snapshot" BETWEEN 0 AND 100)),
	CONSTRAINT "order_lines_amounts_ck" CHECK ("order_lines"."unit_price_snapshot" >= 0 AND "order_lines"."gross_amount_snapshot" >= 0
      AND "order_lines"."line_discount_amount_snapshot" >= 0
      AND "order_lines"."net_after_line_discount_amount_snapshot" >= 0
      AND "order_lines"."overall_discount_allocation_amount_snapshot" >= 0
      AND "order_lines"."net_merchandise_amount_snapshot" >= 0
      AND "order_lines"."commission_basis_amount_snapshot" >= 0
      AND ("order_lines"."commission_value_amount_snapshot" IS NULL OR "order_lines"."commission_value_amount_snapshot" >= 0)),
	CONSTRAINT "order_lines_commission_ck" CHECK (("order_lines"."commission_source_snapshot" = 'none'
        AND "order_lines"."commission_rate_snapshot" IS NULL
        AND "order_lines"."commission_value_amount_snapshot" IS NULL
        AND "order_lines"."commission_rule_id" IS NULL)
      OR ("order_lines"."commission_source_snapshot" <> 'none'
        AND "order_lines"."commission_rate_snapshot" BETWEEN 0 AND 100
        AND "order_lines"."commission_value_amount_snapshot" IS NOT NULL)),
	CONSTRAINT "order_lines_taxes_json_ck" CHECK (jsonb_typeof("order_lines"."taxes_snapshot") = 'array')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_quote_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"customer_id" uuid NOT NULL,
	"representative_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"carrier_id" uuid,
	"customer_legal_name_snapshot" text NOT NULL,
	"customer_trade_name_snapshot" text,
	"customer_tax_id_snapshot" text,
	"customer_address_snapshot" text,
	"representative_name_snapshot" text NOT NULL,
	"price_list_key_snapshot" "price_list_key" NOT NULL,
	"price_list_name_snapshot" text NOT NULL,
	"carrier_name_snapshot" text,
	"valid_until_snapshot" date NOT NULL,
	"currency_code" char(3) DEFAULT 'BRL' NOT NULL,
	"freight_terms" text,
	"payment_terms" text,
	"notes" text,
	"overall_discount_rate" numeric(9, 6),
	"gross_amount" numeric(19, 2) NOT NULL,
	"line_discount_amount" numeric(19, 2) NOT NULL,
	"net_after_line_discount_amount" numeric(19, 2) NOT NULL,
	"overall_discount_amount" numeric(19, 2) NOT NULL,
	"net_merchandise_amount" numeric(19, 2) NOT NULL,
	"tax_totals_snapshot" jsonb NOT NULL,
	"freight_amount" numeric(19, 2) NOT NULL,
	"grand_total_amount" numeric(19, 2) NOT NULL,
	"commission_basis_amount" numeric(19, 2) NOT NULL,
	"commission_value_amount" numeric(19, 2) NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"invoiced_at" timestamp with time zone,
	"invoiced_by_user_id" uuid,
	"invoice_reference" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_source_quote_uq" UNIQUE("source_quote_id"),
	CONSTRAINT "orders_number_uq" UNIQUE("number"),
	CONSTRAINT "orders_number_ck" CHECK ("orders"."number" ~ '^PED-[0-9]{4}-[0-9]{6}$'),
	CONSTRAINT "orders_currency_ck" CHECK ("orders"."currency_code" = 'BRL'),
	CONSTRAINT "orders_amounts_ck" CHECK ("orders"."gross_amount" >= 0 AND "orders"."line_discount_amount" >= 0
        AND "orders"."net_after_line_discount_amount" >= 0 AND "orders"."overall_discount_amount" >= 0
        AND "orders"."net_merchandise_amount" >= 0 AND "orders"."freight_amount" >= 0
        AND "orders"."grand_total_amount" >= 0 AND "orders"."commission_basis_amount" >= 0
        AND "orders"."commission_value_amount" >= 0
        AND ("orders"."overall_discount_rate" IS NULL OR "orders"."overall_discount_rate" BETWEEN 0 AND 100)),
	CONSTRAINT "orders_workflow_pairs_ck" CHECK ((("orders"."confirmed_at" IS NULL) = ("orders"."confirmed_by_user_id" IS NULL))
        AND (("orders"."invoiced_at" IS NULL) = ("orders"."invoiced_by_user_id" IS NULL))
        AND (("orders"."completed_at" IS NULL) = ("orders"."completed_by_user_id" IS NULL))
        AND (("orders"."cancelled_at" IS NULL) = ("orders"."cancelled_by_user_id" IS NULL))),
	CONSTRAINT "orders_carrier_snapshot_ck" CHECK (("orders"."carrier_id" IS NULL AND "orders"."carrier_name_snapshot" IS NULL)
        OR ("orders"."carrier_id" IS NOT NULL AND "orders"."carrier_name_snapshot" IS NOT NULL AND btrim("orders"."carrier_name_snapshot") <> '')),
	CONSTRAINT "orders_cancellation_ck" CHECK ("orders"."cancelled_at" IS NULL OR ("orders"."cancellation_reason" IS NOT NULL AND btrim("orders"."cancellation_reason") <> '')),
	CONSTRAINT "orders_tax_totals_json_ck" CHECK (jsonb_typeof("orders"."tax_totals_snapshot") = 'array')
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "price_list_key" NOT NULL,
	"display_name" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_key_uq" UNIQUE("key"),
	CONSTRAINT "price_lists_position_uq" UNIQUE("position"),
	CONSTRAINT "price_lists_key_position_ck" CHECK (("price_lists"."key" = 'PRICE_1' AND "price_lists"."position" = 1)
        OR ("price_lists"."key" = 'PRICE_2' AND "price_lists"."position" = 2)
        OR ("price_lists"."key" = 'PRICE_3' AND "price_lists"."position" = 3)
        OR ("price_lists"."key" = 'PRICE_4' AND "price_lists"."position" = 4))
);
--> statement-breakpoint
CREATE TABLE "product_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "product_asset_kind" NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "product_assets_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "product_assets_size_ck" CHECK ("product_assets"."size_bytes" > 0),
	CONSTRAINT "product_assets_position_ck" CHECK (("product_assets"."kind" = 'image' AND "product_assets"."position" IS NOT NULL AND "product_assets"."position" >= 0)
        OR ("product_assets"."kind" <> 'image' AND "product_assets"."position" IS NULL)),
	CONSTRAINT "product_assets_archive_actor_ck" CHECK (("product_assets"."archived_at" IS NULL) = ("product_assets"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"amount" numeric(19, 6) NOT NULL,
	"currency_code" char(3) DEFAULT 'BRL' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"ended_by_user_id" uuid,
	"reason" text NOT NULL,
	CONSTRAINT "product_prices_amount_ck" CHECK ("product_prices"."amount" >= 0),
	CONSTRAINT "product_prices_currency_ck" CHECK ("product_prices"."currency_code" = 'BRL'),
	CONSTRAINT "product_prices_reason_ck" CHECK (btrim("product_prices"."reason") <> ''),
	CONSTRAINT "product_prices_validity_ck" CHECK (("product_prices"."valid_to" IS NULL OR "product_prices"."valid_to" > "product_prices"."valid_from")
        AND (("product_prices"."valid_to" IS NULL) = ("product_prices"."ended_by_user_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry_id" uuid NOT NULL,
	"internal_code" text NOT NULL,
	"manufacturer_code" text,
	"description" text NOT NULL,
	"brand" text,
	"category" text,
	"ncm" text,
	"cest" text,
	"ean" text,
	"dun" text,
	"packaging" text,
	"unit" text NOT NULL,
	"net_weight" numeric(18, 6),
	"gross_weight" numeric(18, 6),
	"width" numeric(18, 6),
	"height" numeric(18, 6),
	"depth" numeric(18, 6),
	"dimension_unit" text,
	"ipi_rate" numeric(9, 6),
	"icms_rate" numeric(9, 6),
	"pis_rate" numeric(9, 6),
	"cofins_rate" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "products_internal_code_uq" UNIQUE("internal_code"),
	CONSTRAINT "products_required_text_ck" CHECK (btrim("products"."internal_code") <> '' AND btrim("products"."description") <> '' AND btrim("products"."unit") <> ''),
	CONSTRAINT "products_measurements_ck" CHECK (("products"."net_weight" IS NULL OR "products"."net_weight" >= 0)
        AND ("products"."gross_weight" IS NULL OR "products"."gross_weight" >= 0)
        AND ("products"."width" IS NULL OR "products"."width" >= 0)
        AND ("products"."height" IS NULL OR "products"."height" >= 0)
        AND ("products"."depth" IS NULL OR "products"."depth" >= 0)),
	CONSTRAINT "products_dimension_unit_ck" CHECK (("products"."width" IS NULL AND "products"."height" IS NULL AND "products"."depth" IS NULL)
        OR ("products"."dimension_unit" IS NOT NULL AND btrim("products"."dimension_unit") <> '')),
	CONSTRAINT "products_rates_ck" CHECK (("products"."ipi_rate" IS NULL OR "products"."ipi_rate" BETWEEN 0 AND 100)
        AND ("products"."icms_rate" IS NULL OR "products"."icms_rate" BETWEEN 0 AND 100)
        AND ("products"."pis_rate" IS NULL OR "products"."pis_rate" BETWEEN 0 AND 100)
        AND ("products"."cofins_rate" IS NULL OR "products"."cofins_rate" BETWEEN 0 AND 100)),
	CONSTRAINT "products_archive_actor_ck" CHECK (("products"."archived_at" IS NULL) = ("products"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "quote_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" "quote_status",
	"to_status" "quote_status",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "actor_role" NOT NULL,
	"command_id" uuid NOT NULL,
	"reason" text,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "quote_events_type_ck" CHECK (btrim("quote_events"."event_type") <> ''),
	CONSTRAINT "quote_events_actor_ck" CHECK (("quote_events"."actor_role" = 'system' AND "quote_events"."actor_user_id" IS NULL)
        OR ("quote_events"."actor_role" <> 'system' AND "quote_events"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "quote_events_metadata_ck" CHECK (jsonb_typeof("quote_events"."metadata") = 'object'
        AND jsonb_typeof("quote_events"."metadata"->'version') = 'number'
        AND ("quote_events"."metadata"->>'version')::numeric > 0
        AND mod(("quote_events"."metadata"->>'version')::numeric, 1) = 0)
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"product_price_id" uuid NOT NULL,
	"price_source" "price_source" NOT NULL,
	"product_code_snapshot" text NOT NULL,
	"product_description_snapshot" text NOT NULL,
	"manufacturer_code_snapshot" text,
	"brand_snapshot" text,
	"packaging_snapshot" text,
	"unit_snapshot" text NOT NULL,
	"industry_id_snapshot" uuid NOT NULL,
	"industry_name_snapshot" text NOT NULL,
	"price_list_id_snapshot" uuid NOT NULL,
	"price_list_key_snapshot" "price_list_key" NOT NULL,
	"price_list_name_snapshot" text NOT NULL,
	"unit_price_snapshot" numeric(19, 6) NOT NULL,
	"currency_code" char(3) DEFAULT 'BRL' NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"line_discount_rate" numeric(9, 6) NOT NULL,
	"gross_amount_snapshot" numeric(19, 2) NOT NULL,
	"line_discount_amount_snapshot" numeric(19, 2) NOT NULL,
	"net_after_line_discount_amount_snapshot" numeric(19, 2) NOT NULL,
	"overall_discount_allocation_amount_snapshot" numeric(19, 2) NOT NULL,
	"net_merchandise_amount_snapshot" numeric(19, 2) NOT NULL,
	"taxes_snapshot" jsonb NOT NULL,
	"ipi_rate_snapshot" numeric(9, 6),
	"icms_rate_snapshot" numeric(9, 6),
	"pis_rate_snapshot" numeric(9, 6),
	"cofins_rate_snapshot" numeric(9, 6),
	"commission_rule_id" uuid,
	"commission_source_snapshot" "commission_source" NOT NULL,
	"commission_rate_snapshot" numeric(9, 6),
	"commission_basis_amount_snapshot" numeric(19, 2) NOT NULL,
	"commission_value_amount_snapshot" numeric(19, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	CONSTRAINT "quote_lines_quote_position_uq" UNIQUE("quote_id","position"),
	CONSTRAINT "quote_lines_position_ck" CHECK ("quote_lines"."position" > 0),
	CONSTRAINT "quote_lines_quantity_ck" CHECK ("quote_lines"."quantity" > 0),
	CONSTRAINT "quote_lines_currency_ck" CHECK ("quote_lines"."currency_code" = 'BRL'),
	CONSTRAINT "quote_lines_rates_ck" CHECK ("quote_lines"."line_discount_rate" BETWEEN 0 AND 100
      AND ("quote_lines"."ipi_rate_snapshot" IS NULL OR "quote_lines"."ipi_rate_snapshot" BETWEEN 0 AND 100)
      AND ("quote_lines"."icms_rate_snapshot" IS NULL OR "quote_lines"."icms_rate_snapshot" BETWEEN 0 AND 100)
      AND ("quote_lines"."pis_rate_snapshot" IS NULL OR "quote_lines"."pis_rate_snapshot" BETWEEN 0 AND 100)
      AND ("quote_lines"."cofins_rate_snapshot" IS NULL OR "quote_lines"."cofins_rate_snapshot" BETWEEN 0 AND 100)),
	CONSTRAINT "quote_lines_amounts_ck" CHECK ("quote_lines"."unit_price_snapshot" >= 0 AND "quote_lines"."gross_amount_snapshot" >= 0
      AND "quote_lines"."line_discount_amount_snapshot" >= 0
      AND "quote_lines"."net_after_line_discount_amount_snapshot" >= 0
      AND "quote_lines"."overall_discount_allocation_amount_snapshot" >= 0
      AND "quote_lines"."net_merchandise_amount_snapshot" >= 0
      AND "quote_lines"."commission_basis_amount_snapshot" >= 0
      AND ("quote_lines"."commission_value_amount_snapshot" IS NULL OR "quote_lines"."commission_value_amount_snapshot" >= 0)),
	CONSTRAINT "quote_lines_commission_ck" CHECK (("quote_lines"."commission_source_snapshot" = 'none'
        AND "quote_lines"."commission_rate_snapshot" IS NULL
        AND "quote_lines"."commission_value_amount_snapshot" IS NULL
        AND "quote_lines"."commission_rule_id" IS NULL)
      OR ("quote_lines"."commission_source_snapshot" <> 'none'
        AND "quote_lines"."commission_rate_snapshot" BETWEEN 0 AND 100
        AND "quote_lines"."commission_value_amount_snapshot" IS NOT NULL)),
	CONSTRAINT "quote_lines_taxes_json_ck" CHECK (jsonb_typeof("quote_lines"."taxes_snapshot") = 'array')
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"representative_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"carrier_id" uuid,
	"valid_until" date NOT NULL,
	"currency_code" char(3) DEFAULT 'BRL' NOT NULL,
	"customer_legal_name_snapshot" text NOT NULL,
	"customer_trade_name_snapshot" text,
	"customer_tax_id_snapshot" text,
	"customer_address_snapshot" text,
	"representative_name_snapshot" text NOT NULL,
	"price_list_key_snapshot" "price_list_key" NOT NULL,
	"price_list_name_snapshot" text NOT NULL,
	"carrier_name_snapshot" text,
	"freight_terms" text,
	"payment_terms" text,
	"notes" text,
	"overall_discount_rate" numeric(9, 6),
	"gross_amount" numeric(19, 2) NOT NULL,
	"line_discount_amount" numeric(19, 2) NOT NULL,
	"net_after_line_discount_amount" numeric(19, 2) NOT NULL,
	"overall_discount_amount" numeric(19, 2) NOT NULL,
	"net_merchandise_amount" numeric(19, 2) NOT NULL,
	"tax_totals_snapshot" jsonb NOT NULL,
	"freight_amount" numeric(19, 2) NOT NULL,
	"grand_total_amount" numeric(19, 2) NOT NULL,
	"commission_basis_amount" numeric(19, 2) NOT NULL,
	"commission_value_amount" numeric(19, 2) NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"expired_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"converted_by_user_id" uuid,
	"converted_order_id" uuid,
	"duplicated_from_quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	CONSTRAINT "quotes_number_uq" UNIQUE("number"),
	CONSTRAINT "quotes_number_ck" CHECK ("quotes"."number" ~ '^ORC-[0-9]{4}-[0-9]{6}$'),
	CONSTRAINT "quotes_currency_ck" CHECK ("quotes"."currency_code" = 'BRL'),
	CONSTRAINT "quotes_amounts_ck" CHECK ("quotes"."gross_amount" >= 0 AND "quotes"."line_discount_amount" >= 0
        AND "quotes"."net_after_line_discount_amount" >= 0 AND "quotes"."overall_discount_amount" >= 0
        AND "quotes"."net_merchandise_amount" >= 0 AND "quotes"."freight_amount" >= 0
        AND "quotes"."grand_total_amount" >= 0 AND "quotes"."commission_basis_amount" >= 0
        AND "quotes"."commission_value_amount" >= 0
        AND ("quotes"."overall_discount_rate" IS NULL OR "quotes"."overall_discount_rate" BETWEEN 0 AND 100)),
	CONSTRAINT "quotes_carrier_snapshot_ck" CHECK (("quotes"."carrier_id" IS NULL AND "quotes"."carrier_name_snapshot" IS NULL)
        OR ("quotes"."carrier_id" IS NOT NULL AND "quotes"."carrier_name_snapshot" IS NOT NULL AND btrim("quotes"."carrier_name_snapshot") <> '')),
	CONSTRAINT "quotes_workflow_pairs_ck" CHECK ((("quotes"."sent_at" IS NULL) = ("quotes"."sent_by_user_id" IS NULL))
        AND (("quotes"."approved_at" IS NULL) = ("quotes"."approved_by_user_id" IS NULL))
        AND (("quotes"."rejected_at" IS NULL) = ("quotes"."rejected_by_user_id" IS NULL))
        AND (("quotes"."cancelled_at" IS NULL) = ("quotes"."cancelled_by_user_id" IS NULL))
        AND (("quotes"."converted_at" IS NULL) = ("quotes"."converted_by_user_id" IS NULL))),
	CONSTRAINT "quotes_workflow_reasons_ck" CHECK (("quotes"."rejected_at" IS NULL OR ("quotes"."rejection_reason" IS NOT NULL AND btrim("quotes"."rejection_reason") <> ''))
        AND ("quotes"."cancelled_at" IS NULL OR ("quotes"."cancellation_reason" IS NOT NULL AND btrim("quotes"."cancellation_reason") <> ''))),
	CONSTRAINT "quotes_conversion_ck" CHECK (("quotes"."status" = 'converted'
          AND "quotes"."converted_order_id" IS NOT NULL
          AND "quotes"."converted_at" IS NOT NULL
          AND "quotes"."converted_by_user_id" IS NOT NULL)
        OR ("quotes"."status" <> 'converted'
          AND "quotes"."converted_order_id" IS NULL
          AND "quotes"."converted_at" IS NULL
          AND "quotes"."converted_by_user_id" IS NULL)),
	CONSTRAINT "quotes_tax_totals_json_ck" CHECK (jsonb_typeof("quotes"."tax_totals_snapshot") = 'array')
);
--> statement-breakpoint
CREATE TABLE "record_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"customer_id" uuid,
	"quote_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "record_assignments_target_ck" CHECK (num_nonnulls("record_assignments"."customer_id", "record_assignments"."quote_id", "record_assignments"."order_id") = 1),
	CONSTRAINT "record_assignments_revocation_ck" CHECK (("record_assignments"."revoked_at" IS NULL) = ("record_assignments"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "representatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"internal_code" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" uuid,
	CONSTRAINT "representatives_user_id_uq" UNIQUE("user_id"),
	CONSTRAINT "representatives_display_name_ck" CHECK (btrim("representatives"."display_name") <> ''),
	CONSTRAINT "representatives_archive_actor_ck" CHECK (("representatives"."archived_at" IS NULL) = ("representatives"."archived_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_uq" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	CONSTRAINT "settings_key_uq" UNIQUE("key"),
	CONSTRAINT "settings_key_ck" CHECK ("settings"."key" = 'business'),
	CONSTRAINT "settings_version_ck" CHECK ("settings"."version" > 0),
	CONSTRAINT "settings_value_json_ck" CHECK (jsonb_typeof("settings"."value") = 'object')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" NOT NULL,
	"auth_subject" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_subject_uq" UNIQUE("auth_subject"),
	CONSTRAINT "users_name_ck" CHECK (btrim("users"."name") <> ''),
	CONSTRAINT "users_email_ck" CHECK (btrim("users"."email") <> ''),
	CONSTRAINT "users_disabled_actor_ck" CHECK (("users"."disabled_at" IS NULL) = ("users"."disabled_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_responsible_representative_id_representatives_id_fk" FOREIGN KEY ("responsible_representative_id") REFERENCES "public"."representatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industries" ADD CONSTRAINT "industries_logo_asset_id_product_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."product_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industries" ADD CONSTRAINT "industries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industries" ADD CONSTRAINT "industries_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industries" ADD CONSTRAINT "industries_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_source_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("source_quote_line_id") REFERENCES "public"."quote_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_price_id_product_prices_id_fk" FOREIGN KEY ("product_price_id") REFERENCES "public"."product_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_industry_id_snapshot_industries_id_fk" FOREIGN KEY ("industry_id_snapshot") REFERENCES "public"."industries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_price_list_id_snapshot_price_lists_id_fk" FOREIGN KEY ("price_list_id_snapshot") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_quote_id_quotes_id_fk" FOREIGN KEY ("source_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_representative_id_representatives_id_fk" FOREIGN KEY ("representative_id") REFERENCES "public"."representatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoiced_by_user_id_users_id_fk" FOREIGN KEY ("invoiced_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_price_id_product_prices_id_fk" FOREIGN KEY ("product_price_id") REFERENCES "public"."product_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_industry_id_snapshot_industries_id_fk" FOREIGN KEY ("industry_id_snapshot") REFERENCES "public"."industries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_price_list_id_snapshot_price_lists_id_fk" FOREIGN KEY ("price_list_id_snapshot") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_representative_id_representatives_id_fk" FOREIGN KEY ("representative_id") REFERENCES "public"."representatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_by_user_id_users_id_fk" FOREIGN KEY ("converted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_duplicated_from_quote_id_quotes_id_fk" FOREIGN KEY ("duplicated_from_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_assignments" ADD CONSTRAINT "record_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representatives" ADD CONSTRAINT "representatives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representatives" ADD CONSTRAINT "representatives_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representatives" ADD CONSTRAINT "representatives_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representatives" ADD CONSTRAINT "representatives_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_disabled_by_user_id_users_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_active_order_idx" ON "attachments" USING btree ("order_id","uploaded_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "attachments"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_active_name_uidx" ON "carriers" USING btree (lower(btrim("name"))) WHERE "carriers"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "carriers_active_name_idx" ON "carriers" USING btree (lower("name"),"id") WHERE "carriers"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_current_industry_uidx" ON "commission_rules" USING btree ("industry_id") WHERE "commission_rules"."scope" = 'industry_default' AND "commission_rules"."valid_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_current_product_uidx" ON "commission_rules" USING btree ("product_id") WHERE "commission_rules"."scope" = 'product_override' AND "commission_rules"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "commission_rules_industry_history_idx" ON "commission_rules" USING btree ("industry_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "commission_rules_product_history_idx" ON "commission_rules" USING btree ("product_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "customers_active_tax_id_uidx" ON "customers" USING btree ("tax_id") WHERE "customers"."tax_id" IS NOT NULL AND "customers"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "customers_active_name_idx" ON "customers" USING btree (lower("legal_name"),"id") WHERE "customers"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "customers_representative_idx" ON "customers" USING btree ("responsible_representative_id","id");--> statement-breakpoint
CREATE INDEX "idempotency_records_actor_created_idx" ON "idempotency_records" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "industries_active_tax_id_uidx" ON "industries" USING btree ("tax_id") WHERE "industries"."tax_id" IS NOT NULL AND "industries"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "industries_active_name_idx" ON "industries" USING btree (lower("legal_name"),"id") WHERE "industries"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "order_events_history_idx" ON "order_events" USING btree ("order_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "order_events_command_idx" ON "order_events" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_representative_idx" ON "orders" USING btree ("representative_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "product_assets_active_image_position_uidx" ON "product_assets" USING btree ("product_id","position") WHERE "product_assets"."kind" = 'image' AND "product_assets"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_assets_active_document_kind_uidx" ON "product_assets" USING btree ("product_id","kind") WHERE "product_assets"."kind" <> 'image' AND "product_assets"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "product_assets_product_kind_idx" ON "product_assets" USING btree ("product_id","kind","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_current_uidx" ON "product_prices" USING btree ("product_id","price_list_id") WHERE "product_prices"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "product_prices_history_idx" ON "product_prices" USING btree ("product_id","price_list_id","valid_from" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_industry_idx" ON "products" USING btree ("industry_id","id");--> statement-breakpoint
CREATE INDEX "products_active_description_idx" ON "products" USING btree (lower("description"),"id") WHERE "products"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "quote_events_history_idx" ON "quote_events" USING btree ("quote_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "quote_events_command_idx" ON "quote_events" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "quote_lines_product_idx" ON "quote_lines" USING btree ("product_id","quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_converted_order_uidx" ON "quotes" USING btree ("converted_order_id") WHERE "quotes"."converted_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "quotes_status_created_idx" ON "quotes" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "quotes_representative_idx" ON "quotes" USING btree ("representative_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "record_assignments_active_customer_uidx" ON "record_assignments" USING btree ("assignee_user_id","customer_id") WHERE "record_assignments"."customer_id" IS NOT NULL AND "record_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "record_assignments_active_quote_uidx" ON "record_assignments" USING btree ("assignee_user_id","quote_id") WHERE "record_assignments"."quote_id" IS NOT NULL AND "record_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "record_assignments_active_order_uidx" ON "record_assignments" USING btree ("assignee_user_id","order_id") WHERE "record_assignments"."order_id" IS NOT NULL AND "record_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "record_assignments_assignee_idx" ON "record_assignments" USING btree ("assignee_user_id","revoked_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "representatives_internal_code_uidx" ON "representatives" USING btree ("internal_code") WHERE "representatives"."internal_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "representatives_active_name_idx" ON "representatives" USING btree (lower("display_name"),"id") WHERE "representatives"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","disabled_at","id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");