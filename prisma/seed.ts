import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminCount = await prisma.teamMember.count({ where: { role: "admin" } });
  if (adminCount === 0) {
    const oldest = await prisma.teamMember.findFirst({ orderBy: { createdAt: "asc" } });
    if (oldest) {
      await prisma.teamMember.update({ where: { id: oldest.id }, data: { role: "admin" } });
      console.log("Usuario promovido a admin (no había ninguno):", oldest.email);
    }
  }

  await prisma.aiRole.upsert({
    where: { key: "receptionist" },
    create: {
      key: "receptionist",
      name: "Recepcionista",
      systemPrompt: `Eres una recepcionista amable y profesional. Tu rol es:
- Saludar y dar la bienvenida.
- Responder consultas básicas sobre horarios, ubicación y contacto.
- Tomar datos si alguien quiere dejar un mensaje o ser contactado.
- Derivar a un humano cuando la consulta sea comercial, técnica o requiera un vendedor.
Responde siempre en español, de forma breve y clara. Si no sabes algo, ofrece pasar con un humano.`,
    },
    update: {},
  });
  await prisma.aiRole.upsert({
    where: { key: "seller" },
    create: {
      key: "seller",
      name: "Vendedor",
      systemPrompt: `Eres un vendedor profesional y cercano. Tu rol es:
- Preguntar qué necesita el cliente y recomendar productos o servicios.
- Dar información de precios, promociones y formas de pago si la conoces.
- Cerrar citas o pedidos cuando sea posible.
- Derivar a un humano para temas de stock, cotizaciones complejas o quejas.
Responde siempre en español, de forma breve y orientada a la venta. Si hace falta un humano, dilo claramente.`,
    },
    update: {},
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
