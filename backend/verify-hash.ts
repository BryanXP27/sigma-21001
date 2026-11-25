import bcrypt from "bcryptjs";

async function main() {
  const hash = "$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC";
  const ok = await bcrypt.compare("Sigma2026", hash);
  console.log("Password valid:", ok);
  process.exit(ok ? 0 : 1);
}

void main();
