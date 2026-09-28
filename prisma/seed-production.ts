/* eslint-disable no-console */
/**
 * Production bootstrap: creates the administrator account and the firm
 * profile on an empty database, and nothing else (no demo data).
 *
 *   ADMIN_EMAIL=admin@beipoready.com ADMIN_PASSWORD=… ADMIN_NAME="Rakesh Doshi" npm run db:seed:prod
 *
 * Safe to re-run: existing users are left untouched.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@beipoready.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "beipoready@123456";
  const name = process.env.ADMIN_NAME ?? "Rakesh Doshi";
  const designation = process.env.ADMIN_DESIGNATION ?? "CEO";

  const users = await prisma.user.count();
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { name, email, role: "ADMIN", active: true, designation, passwordHash: await bcrypt.hash(password, 12), onboardedAt: new Date() },
    });
    console.log(`Created administrator ${name} <${email}>.`);
  } else {
    console.log(`Administrator ${email} already exists (${users} users) — left unchanged.`);
  }

  const profile = { firmName: "Be IPO Ready", tagline: "India's leading IPO advisor & growth capital expert", website: "https://beipoready.com", email, systemSenderUserId: admin.id };
  await prisma.companyProfile.upsert({ where: { id: 1 }, create: { id: 1, ...profile }, update: { systemSenderUserId: admin.id, email: profile.email } });
  console.log("Firm profile ready; system email sender:", email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
