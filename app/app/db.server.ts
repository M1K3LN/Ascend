import { PrismaClient } from "@prisma/client";

// One client per lambda; DATABASE_URL points at the Supavisor transaction
// pooler with connection_limit=1 — never open unpooled connections at runtime.
declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

const prisma = global.prismaGlobal ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") global.prismaGlobal = prisma;

export default prisma;
