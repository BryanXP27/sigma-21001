import bcrypt from "bcryptjs";
const hash = process.argv[2];
const password = process.argv[3];
const ok = await bcrypt.compare(password, hash);
console.log("Password valid:", ok);
process.exit(ok ? 0 : 1);
