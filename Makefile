.PHONY: install dev build start typecheck \
       db-up db-down db-push db-reset db-seed db-studio \
       seed setup logs

# ── Dependencies ──────────────────────────────────────────
install:
	npm install

# ── Development ───────────────────────────────────────────
dev:
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
	npx prisma db push

db-reset:
	npx prisma db push --force-reset

db-seed:
	npx prisma db seed

db-studio:
	npx prisma studio

# ── Shortcuts ─────────────────────────────────────────────
seed: db-seed

setup: install db-up db-push db-seed  ## Full setup from scratch
	@echo "\n✔ Backend ready. Run 'make dev' to start."

logs:
	docker compose logs -f db
