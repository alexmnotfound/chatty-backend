import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 1. Seed super admin
  const superAdminEmail = "super@chatty.com";
  const existingSuperAdmin = await prisma.superAdmin.findUnique({ where: { email: superAdminEmail } });
  if (!existingSuperAdmin) {
    const hash = await bcrypt.hash("superadmin123", 10);
    await prisma.superAdmin.create({
      data: {
        email: superAdminEmail,
        password: hash,
        name: "Super Admin",
      },
    });
    console.log("Super admin creado:", superAdminEmail, "/ superadmin123");
  } else {
    console.log("Super admin ya existe:", superAdminEmail);
  }

  // 2. Seed demo company
  let company = await prisma.company.findUnique({ where: { slug: "demo" } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "Demo Company",
        slug: "demo",
      },
    });
    console.log("Empresa demo creada:", company.id);
  } else {
    console.log("Empresa demo ya existe:", company.id);
  }

  // 3. Seed company config
  await prisma.companyConfig.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id },
    update: {},
  });

  // 4. Seed company admin
  const adminEmail = "admin@demo.com";
  const existingAdmin = await prisma.teamMember.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const hash = await bcrypt.hash("admin123", 10);
    await prisma.teamMember.create({
      data: {
        companyId: company.id,
        email: adminEmail,
        password: hash,
        name: "Admin Demo",
        role: "admin",
      },
    });
    console.log("Admin de empresa creado:", adminEmail, "/ admin123");
  }

  // 5. Seed AI roles for demo company
  await prisma.aiRole.upsert({
    where: { companyId_key: { companyId: company.id, key: "receptionist" } },
    create: {
      companyId: company.id,
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
    where: { companyId_key: { companyId: company.id, key: "seller" } },
    create: {
      companyId: company.id,
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

  await prisma.aiRole.upsert({
    where: { companyId_key: { companyId: company.id, key: "extractor" } },
    create: {
      companyId: company.id,
      key: "extractor",
      name: "Extractor de Pagos",
      systemPrompt: `Sos un asistente especializado en extraer datos de comprobantes de pago enviados por WhatsApp.
Cuando el cliente envía una imagen o PDF de una transferencia bancaria, factura o recibo, tu rol es:
- Confirmar que recibiste el comprobante.
- Indicar que se está procesando la extracción de datos.
- Informar qué información fue detectada (monto, fecha, remitente, banco).
- Avisar si el documento no es legible o falta información clave.
Respondé siempre en español, de forma clara y concisa. No inventes datos que no estén en el comprobante.`,
    },
    update: {},
  });

  console.log("Roles de IA creados para empresa demo");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
