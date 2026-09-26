FROM oven/bun:1.4.2
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tar gzip && rm -rf /var/lib/apt/lists/*
RUN bun add --global @railway/cli@5.30.4
WORKDIR /app
COPY scripts/promote-staging.ts /app/scripts/promote-staging.ts
COPY candidate/ /candidate/
ENV KEATING_PROMOTION_STATE_DIR=/data
ENV KEATING_PROMOTION_CANDIDATE=/candidate/candidate.json
CMD ["bun", "/app/scripts/promote-staging.ts", "run-hosted"]
