import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Generation/validation need no credentials. Database commands load the
  // chosen env file explicitly, just like our existing API/migration commands.
  datasource: { url: process.env.DATABASE_URL },
});
