.PHONY: install dev build start typecheck \
       db-up db-down db-push db-reset db-new db-seed db-seed-demo \
       seed setup logs tunnel

# ── Dependencies ──────────────────────────────────────────
install:
	npm install

# ── Development ───────────────────────────────────────────
dev:
	docker compose up -d
	npm run dev

build:
	npm run build

start:
	node dist/index.js

typecheck:
	npx tsc --noEmit

# ── Database ──────────────────────────────────────────────
db-up:
	docker compose up -d

db-down:
	docker compose down

db-push:
	npx supabase db push

db-reset:
	npx supabase db reset

db-new:
	@read -p "Migration name: " name; npx supabase migration new $$name

db-seed:
	npx tsx supabase/seed.ts

db-seed-demo:
	npx tsx supabase/seed-demo.ts

# ── Shortcuts ─────────────────────────────────────────────
seed: db-seed

setup: install db-up db-push db-seed  ## Full setup from scratch
	@echo "\n✔ Backend ready. Run 'make dev' to start."

logs:
	docker compose logs -f db

# ── Tunnel (ngrok) ────────────────────────────────────────
tunnel:
	@PORT=$${PORT:-3000}; \
	echo "Exposing http://localhost:$$PORT via ngrok..."; \
	echo "Paste the HTTPS URL + /webhook/whatsapp into Meta → Webhooks"; \
	ngrok http $$PORT
