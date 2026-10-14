#!/usr/bin/env bash
set -euo pipefail

project_id="${GOOGLE_PROJECT_ID:?Set GOOGLE_PROJECT_ID}"
supabase_url="${SUPABASE_URL:?Set SUPABASE_URL}"
topic_id="${PUBSUB_TOPIC:-gmail-notifications}"
subscription_id="${PUBSUB_SUBSCRIPTION_ID:-gmail-notifications-push}"
service_account_id="${PUBSUB_PUSH_SERVICE_ACCOUNT_ID:-gmail-pubsub-push}"
push_endpoint="${PUBSUB_PUSH_ENDPOINT:-${supabase_url%/}/functions/v1/gmail-webhook}"
audience="${PUBSUB_OIDC_AUDIENCE:-$push_endpoint}"
topic_name="projects/${project_id}/topics/${topic_id}"
subscription_name="projects/${project_id}/subscriptions/${subscription_id}"
gmail_publisher="gmail-api-push@system.gserviceaccount.com"
service_account_email="${service_account_id}@${project_id}.iam.gserviceaccount.com"

gcloud pubsub topics describe "$topic_id" --project="$project_id" >/dev/null

if ! gcloud iam service-accounts describe "$service_account_email" \
  --project="$project_id" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$service_account_id" \
    --project="$project_id" \
    --display-name="Gmail Pub/Sub push identity" \
    --quiet
fi

for attempt in {1..10}; do
  if gcloud iam service-accounts describe "$service_account_email" \
    --project="$project_id" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 10 ]]; then
    printf 'Service account %s was not available after creation\n' \
      "$service_account_email" >&2
    exit 1
  fi
  sleep 2
done

project_number="$(gcloud projects describe "$project_id" --format='value(projectNumber)')"
pubsub_service_agent="service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$pubsub_service_agent" \
  --project="$project_id" >/dev/null 2>&1; then
  gcloud beta services identity create \
    --service=pubsub.googleapis.com \
    --project="$project_id" >/dev/null
fi

gcloud iam service-accounts add-iam-policy-binding "$service_account_email" \
  --project="$project_id" \
  --member="serviceAccount:${pubsub_service_agent}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet >/dev/null

gcloud pubsub topics add-iam-policy-binding "$topic_id" \
  --project="$project_id" \
  --member="serviceAccount:${gmail_publisher}" \
  --role="roles/pubsub.publisher" \
  --quiet >/dev/null

if gcloud pubsub subscriptions describe "$subscription_id" \
  --project="$project_id" >/dev/null 2>&1; then
  existing_topic="$(gcloud pubsub subscriptions describe "$subscription_id" \
    --project="$project_id" \
    --format='value(topic)')"
  if [[ "$existing_topic" != "$topic_name" ]]; then
    printf 'Subscription %s already belongs to %s, not %s\n' \
      "$subscription_name" "$existing_topic" "$topic_name" >&2
    exit 1
  fi

  gcloud pubsub subscriptions modify-push-config "$subscription_id" \
    --project="$project_id" \
    --push-endpoint="$push_endpoint" \
    --push-auth-service-account="$service_account_email" \
    --push-auth-token-audience="$audience" \
    --quiet
  gcloud pubsub subscriptions update "$subscription_id" \
    --project="$project_id" \
    --ack-deadline=120 \
    --expiration-period=never \
    --quiet
else
  gcloud pubsub subscriptions create "$subscription_id" \
    --project="$project_id" \
    --topic="$topic_id" \
    --push-endpoint="$push_endpoint" \
    --push-auth-service-account="$service_account_email" \
    --push-auth-token-audience="$audience" \
    --ack-deadline=120 \
    --expiration-period=never \
    --quiet
fi

service_account_subject=""
for attempt in {1..10}; do
  service_account_subject="$(gcloud iam service-accounts describe "$service_account_email" \
    --project="$project_id" \
    --format='value(uniqueId)' 2>/dev/null || true)"
  if [[ -n "$service_account_subject" ]]; then
    break
  fi
  if [[ "$attempt" == 10 ]]; then
    printf 'Could not read the unique ID for %s\n' "$service_account_email" >&2
    exit 1
  fi
  sleep 2
done

printf 'PUBSUB_OIDC_AUDIENCE=%s\n' "$audience"
printf 'PUBSUB_OIDC_SERVICE_ACCOUNT_EMAIL=%s\n' "$service_account_email"
printf 'PUBSUB_OIDC_SERVICE_ACCOUNT_SUB=%s\n' "$service_account_subject"
printf 'PUBSUB_EXPECTED_SUBSCRIPTION=%s\n' "$subscription_name"
