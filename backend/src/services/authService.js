const { PrismaClient } = require('@prisma/client');
const { compare, hash } = require('../utils/password');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');

const prisma = new PrismaClient();

async function login(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const valid = await compare(password, user.passwordHash);
  if (!valid) return null;

  const payload = { id: user.id, role: user.role, name: user.name, email: user.email };
  return {
    user: payload,
    accessToken: signAccess(payload),
    refreshToken: signRefresh({ id: user.id }),
  };
}

async function refresh(token) {
  const decoded = verifyRefresh(token);
  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user) return null;

  const payload = { id: user.id, role: user.role, name: user.name, email: user.email };
  return {
    accessToken: signAccess(payload),
    refreshToken: signRefresh({ id: user.id }),
  };
}

async function createUser(data) {
  const passwordHash = await hash(data.password);
  return prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash, role: data.role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
}

module.exports = { login, refresh, createUser };
