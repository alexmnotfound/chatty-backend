import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const DEMO_CONTACTS = [
  {
    waId: "5491122334455",
    name: "María González",
    conversations: [
      {
        status: "ai",
        unreadCount: 2,
        aiRoleKey: "receptionist",
        messages: [
          { direction: "in", body: "Hola! me pueden decir el precio del plan mensual?", fromAi: false, minutesAgo: 45 },
          { direction: "out", body: "¡Hola María! Bienvenida 😊 Claro que sí. ¿Podés contarme un poco más sobre tu negocio para recomendarte el plan más adecuado?", fromAi: true, minutesAgo: 44 },
          { direction: "in", body: "Tengo una tienda de ropa, somos 3 personas en el equipo", fromAi: false, minutesAgo: 40 },
          { direction: "out", body: "Perfecto, para equipos de hasta 5 personas tenemos el plan Team a $15.000/mes que incluye inbox compartido, historial completo y 2 agentes de IA. ¿Te mando más info?", fromAi: true, minutesAgo: 39 },
          { direction: "in", body: "si porfavor, y tienen prueba gratis?", fromAi: false, minutesAgo: 10 },
          { direction: "in", body: "también quiero saber si puedo cancelar cuando quiera", fromAi: false, minutesAgo: 8 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491133445566",
    name: "Carlos Rodríguez",
    conversations: [
      {
        status: "human",
        unreadCount: 1,
        aiRoleKey: "seller",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "Buenos días, necesito una cotización para 50 unidades del producto premium. Somos una empresa.", fromAi: false, minutesAgo: 120 },
          { direction: "out", body: "¡Buenos días Carlos! Qué bueno saberlo. Te paso con uno de nuestros vendedores para armar una propuesta a medida para tu empresa.", fromAi: true, minutesAgo: 119 },
          { direction: "out", body: "Hola Carlos, soy Martín del equipo comercial. Recibí tu consulta. ¿Me podés dar más detalle del producto que necesitás y para cuándo lo necesitás?", fromAi: false, minutesAgo: 115 },
          { direction: "in", body: "Claro, es el modelo X300, lo necesitamos para el 15 del mes que viene. Tenemos presupuesto aprobado.", fromAi: false, minutesAgo: 110 },
          { direction: "out", body: "Perfecto, te preparo la cotización hoy mismo. ¿A qué mail te la mando?", fromAi: false, minutesAgo: 108 },
          { direction: "in", body: "carlos.rodriguez@empresa.com, gracias", fromAi: false, minutesAgo: 5 },
        ],
        tasks: [
          { title: "Enviar cotización X300 × 50u a Carlos", description: "Cotización para empresa. 50 unidades modelo X300. Entrega requerida antes del 15. Mail: carlos.rodriguez@empresa.com", status: "pending", daysFromNow: 1 },
        ],
      },
    ],
  },
  {
    waId: "5491144556677",
    name: "Laura Martínez",
    conversations: [
      {
        status: "human",
        unreadCount: 3,
        aiRoleKey: "receptionist",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "Hola, hice un pedido hace 10 días y todavía no llegó. El número es #4521", fromAi: false, minutesAgo: 200 },
          { direction: "out", body: "Hola Laura, entiendo tu preocupación. Voy a revisar el estado de tu pedido #4521 y te aviso enseguida.", fromAi: true, minutesAgo: 199 },
          { direction: "out", body: "Hola Laura, soy Ana del equipo. Revisé el pedido y hubo un problema con el courier. Ya lo estamos gestionando, ¿podés darme tu dirección para reconfirmar?", fromAi: false, minutesAgo: 185 },
          { direction: "in", body: "Av. Corrientes 1234, piso 3, CABA", fromAi: false, minutesAgo: 180 },
          { direction: "out", body: "Anotado. Vamos a reprogramar el envío para mañana o pasado. Te aviso cuando tengamos confirmación del courier.", fromAi: false, minutesAgo: 178 },
          { direction: "in", body: "ok pero la verdad es que es un re quilombo, la necesitaba para el evento", fromAi: false, minutesAgo: 60 },
          { direction: "in", body: "cuando me confirman?", fromAi: false, minutesAgo: 30 },
          { direction: "in", body: "?", fromAi: false, minutesAgo: 15 },
        ],
        tasks: [
          { title: "Resolver reclamo envío Laura Martínez - pedido #4521", description: "Cliente esperando confirmación de reenvío urgente. Dirección: Av. Corrientes 1234, piso 3, CABA. Contactar courier y confirmar fecha.", status: "pending", daysFromNow: 0 },
        ],
      },
    ],
  },
  {
    waId: "5491155667788",
    name: "Diego Fernández",
    conversations: [
      {
        status: "resolved",
        unreadCount: 0,
        aiRoleKey: "receptionist",
        messages: [
          { direction: "in", body: "buenas, a qué hora cierran hoy?", fromAi: false, minutesAgo: 1440 },
          { direction: "out", body: "¡Hola Diego! Hoy cerramos a las 18hs. ¿Necesitás algo más?", fromAi: true, minutesAgo: 1439 },
          { direction: "in", body: "no gracias, era eso!", fromAi: false, minutesAgo: 1435 },
          { direction: "out", body: "¡Perfecto, hasta luego! 👋", fromAi: true, minutesAgo: 1434 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491166778899",
    name: "Ana López",
    conversations: [
      {
        status: "ai",
        unreadCount: 1,
        aiRoleKey: "seller",
        messages: [
          { direction: "in", body: "Hola! vi su publicidad en instagram y me interesó el servicio", fromAi: false, minutesAgo: 90 },
          { direction: "out", body: "¡Hola Ana! Qué bueno que te interesó 🙌 ¿Qué fue lo que más te llamó la atención? Así te cuento exactamente cómo podemos ayudarte.", fromAi: true, minutesAgo: 89 },
          { direction: "in", body: "lo de los agentes de IA para responder automático, tengo un emprendimiento de cosméticos y me llegan muchos mensajes", fromAi: false, minutesAgo: 80 },
          { direction: "out", body: "¡Perfecto para eso somos! Con nuestro agente Recepcionista podés responder automáticamente consultas frecuentes, y cuando algo necesita atención humana lo derivamos a tu equipo. ¿Cuántos mensajes por día recibís aproximadamente?", fromAi: true, minutesAgo: 79 },
          { direction: "in", body: "como 40-50 por día entre semana, fines de semana más", fromAi: false, minutesAgo: 20 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491177889900",
    name: "Martín Sánchez",
    conversations: [
      {
        status: "resolved",
        unreadCount: 0,
        aiRoleKey: "seller",
        messages: [
          { direction: "in", body: "hola cuanto sale el plan anual?", fromAi: false, minutesAgo: 2880 },
          { direction: "out", body: "¡Hola Martín! El plan anual tiene un 20% de descuento respecto al mensual. Quedaría en $144.000/año (equivale a $12.000/mes). ¿Te gustaría ver qué incluye?", fromAi: true, minutesAgo: 2879 },
          { direction: "in", body: "si está ok, ya lo veo en la web, gracias", fromAi: false, minutesAgo: 2870 },
          { direction: "out", body: "¡Perfecto! Cualquier duda que tengas, estamos acá. ¡Hasta luego! 😊", fromAi: true, minutesAgo: 2869 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491188990011",
    name: "Sofía Pérez",
    conversations: [
      {
        status: "human",
        unreadCount: 0,
        aiRoleKey: "seller",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "Buen día, necesito hablar con alguien del equipo comercial para ver una integración custom", fromAi: false, minutesAgo: 300 },
          { direction: "out", body: "¡Buenos días Sofía! Claro, te conecto con nuestro equipo comercial ahora mismo.", fromAi: true, minutesAgo: 299 },
          { direction: "out", body: "Hola Sofía! Soy Lucía del equipo. ¿De qué tipo de integración necesitás? Así te oriento mejor.", fromAi: false, minutesAgo: 290 },
          { direction: "in", body: "Tenemos un CRM propio y querríamos sincronizar los contactos y conversaciones automáticamente", fromAi: false, minutesAgo: 280 },
          { direction: "out", body: "Entendido. Tenemos una API REST completa para eso. Te paso documentación y coordinamos una llamada técnica si querés.", fromAi: false, minutesAgo: 275 },
          { direction: "in", body: "Perfecto, gracias. Quedamos así.", fromAi: false, minutesAgo: 270 },
        ],
        tasks: [
          { title: "Agendar llamada técnica con Sofía Pérez - integración CRM", description: "Cliente interesada en API para sincronizar CRM propio. Coordinar demo técnica con su equipo.", status: "pending", daysFromNow: 3 },
        ],
      },
    ],
  },
  {
    waId: "5491199001122",
    name: "Roberto García",
    conversations: [
      {
        status: "ai",
        unreadCount: 0,
        aiRoleKey: "receptionist",
        messages: [
          { direction: "in", body: "Hola! Cómo funciona esto?", fromAi: false, minutesAgo: 720 },
          { direction: "out", body: "¡Hola Roberto! Bienvenido 👋 Somos Chatty, una plataforma para gestionar tu WhatsApp de negocio con tu equipo y con ayuda de agentes IA. ¿En qué te puedo ayudar?", fromAi: true, minutesAgo: 719 },
          { direction: "in", body: "ah, tienen algún video demo?", fromAi: false, minutesAgo: 710 },
          { direction: "out", body: "¡Sí! Tenemos un video de 3 minutos en nuestra web. ¿Querés que te mande el link directo o preferís que te explique brevemente cómo funciona?", fromAi: true, minutesAgo: 709 },
          { direction: "in", body: "manda el link", fromAi: false, minutesAgo: 700 },
          { direction: "out", body: "Acá te dejo el link al demo: chatty.app/demo — Cualquier consulta que tengas después del video, estamos acá. 😊", fromAi: true, minutesAgo: 699 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491211223344",
    name: "Valeria Torres",
    conversations: [
      {
        status: "human",
        unreadCount: 2,
        aiRoleKey: "extractor",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "Hola! Te mando el comprobante de la transferencia de hoy", fromAi: false, minutesAgo: 35 },
          { direction: "in", body: "[PDF:comprobante-transferencia-galicia.pdf]", fromAi: false, minutesAgo: 30 },
          { direction: "in", body: "también te mando el del mes pasado que no lo habían procesado", fromAi: false, minutesAgo: 5 },
          { direction: "in", body: "[PDF:pago-marzo-valeria.pdf]", fromAi: false, minutesAgo: 2 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491222334455",
    name: "Hernán Bravo",
    conversations: [
      {
        status: "ai",
        unreadCount: 1,
        aiRoleKey: "extractor",
        messages: [
          { direction: "in", body: "buenos días, les mando los comprobantes de la semana", fromAi: false, minutesAgo: 60 },
          { direction: "in", body: "[IMAGEN:transferencia-lunes.jpg]", fromAi: false, minutesAgo: 55 },
          { direction: "in", body: "[IMAGEN:transferencia-miercoles.jpg]", fromAi: false, minutesAgo: 50 },
          { direction: "in", body: "[PDF:factura-abril.pdf]", fromAi: false, minutesAgo: 10 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491233445566",
    name: "Cecilia Ríos",
    conversations: [
      {
        status: "resolved",
        unreadCount: 0,
        aiRoleKey: "extractor",
        messages: [
          { direction: "in", body: "hola te mando el comprobante del pago de marzo", fromAi: false, minutesAgo: 4320 },
          { direction: "in", body: "[PDF:pago-marzo-2026.pdf]", fromAi: false, minutesAgo: 4318 },
          { direction: "in", body: "perfecto gracias!", fromAi: false, minutesAgo: 4310 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491244556677",
    name: "Rocío Medina",
    conversations: [
      {
        status: "ai",
        unreadCount: 0,
        aiRoleKey: "receptionist",
        messages: [
          { direction: "in", body: "hola, a qué hora abren los sábados?", fromAi: false, minutesAgo: 25 },
          { direction: "out", body: "¡Hola Rocío! Los sábados abrimos de 9 a 13hs. ¿Necesitás algo más?", fromAi: true, minutesAgo: 24 },
          { direction: "in", body: "genial, gracias!", fromAi: false, minutesAgo: 23 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491255667788",
    name: "Fernando Castro",
    conversations: [
      {
        status: "human",
        unreadCount: 2,
        aiRoleKey: "seller",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "Buenas, somos una cadena de 8 locales y queremos evaluar el plan Enterprise", fromAi: false, minutesAgo: 500 },
          { direction: "out", body: "¡Hola Fernando! Excelente. Te derivo con nuestro equipo comercial para armar una propuesta a medida para las 8 sucursales.", fromAi: true, minutesAgo: 499 },
          { direction: "out", body: "Hola Fernando, soy Julián del equipo comercial. Para 8 locales te conviene el plan Enterprise con inbox centralizado. ¿Cada local maneja su propio WhatsApp?", fromAi: false, minutesAgo: 480 },
          { direction: "in", body: "sí, cada local tiene su número pero queremos ver todo desde un panel central", fromAi: false, minutesAgo: 470 },
          { direction: "out", body: "Perfecto, eso es justo lo que hace el plan Enterprise. Te preparo una propuesta con precios por volumen.", fromAi: false, minutesAgo: 465 },
          { direction: "in", body: "dale, y podemos tener una call esta semana para verlo con el resto del equipo?", fromAi: false, minutesAgo: 40 },
          { direction: "in", body: "el jueves a la tarde nos vendría bien", fromAi: false, minutesAgo: 38 },
        ],
        tasks: [
          { title: "Coordinar call Enterprise con Fernando Castro (8 locales)", description: "Propuesta Enterprise multi-sucursal, panel centralizado. Cliente pidió call el jueves a la tarde.", status: "pending", daysFromNow: 2 },
        ],
      },
    ],
  },
  {
    waId: "5491266778899",
    name: "Julieta Paz",
    conversations: [
      {
        status: "resolved",
        unreadCount: 0,
        aiRoleKey: "receptionist",
        messages: [
          { direction: "in", body: "hola! quería saber si tienen soporte en español", fromAi: false, minutesAgo: 6000 },
          { direction: "out", body: "¡Hola Julieta! Sí, todo nuestro soporte es en español y estamos disponibles de lunes a viernes de 9 a 18hs. ¿Hay algo puntual en lo que te podamos ayudar?", fromAi: true, minutesAgo: 5999 },
          { direction: "in", body: "no por ahora, solo quería confirmar antes de contratar. gracias!", fromAi: false, minutesAgo: 5990 },
          { direction: "out", body: "¡Genial! Cualquier consulta, estamos a un mensaje de distancia 😊", fromAi: true, minutesAgo: 5989 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491277889900",
    name: "Nicolás Herrera",
    conversations: [
      {
        status: "ai",
        unreadCount: 1,
        aiRoleKey: "extractor",
        messages: [
          { direction: "in", body: "hola, acá va el comprobante de la seña", fromAi: false, minutesAgo: 18 },
          { direction: "in", body: "[IMAGEN:transferencia-sena-nicolas.jpg]", fromAi: false, minutesAgo: 16 },
        ],
        tasks: [] as any[],
      },
    ],
  },
  {
    waId: "5491288990011",
    name: "Camila Suárez",
    conversations: [
      {
        status: "human",
        unreadCount: 3,
        aiRoleKey: "receptionist",
        assignToAdmin: true,
        messages: [
          { direction: "in", body: "hola, la app se me cerró sola dos veces hoy y perdí lo que estaba escribiendo", fromAi: false, minutesAgo: 50 },
          { direction: "out", body: "¡Hola Camila! Qué mal, disculpá las molestias. Te paso con soporte técnico para revisar qué está pasando.", fromAi: true, minutesAgo: 49 },
          { direction: "in", body: "es bastante urgente porque lo necesito para laburar hoy", fromAi: false, minutesAgo: 45 },
          { direction: "in", body: "alguien me puede ayudar?", fromAi: false, minutesAgo: 12 },
        ],
        tasks: [
          { title: "Bug: app se cierra sola — Camila Suárez", description: "Cliente reporta cierres inesperados de la app, pérdida de texto sin guardar. Urgente, lo necesita para trabajar hoy.", status: "pending", daysFromNow: 0 },
        ],
      },
    ],
  },
  {
    waId: "5491299001122",
    name: "Tomás Aguirre",
    conversations: [
      {
        status: "resolved",
        unreadCount: 0,
        aiRoleKey: "seller",
        messages: [
          { direction: "in", body: "hola, ya tengo el plan Team pero quería preguntar si puedo sumar un agente de IA más", fromAi: false, minutesAgo: 1000 },
          { direction: "out", body: "¡Hola Tomás! Sí, podés agregar agentes adicionales por $3.000/mes cada uno. ¿Querés que te lo sume ahora?", fromAi: true, minutesAgo: 999 },
          { direction: "in", body: "sí dale, sumalo", fromAi: false, minutesAgo: 990 },
          { direction: "out", body: "¡Listo! Ya tenés el agente adicional activo en tu cuenta. Cualquier cosa avisame 🙌", fromAi: true, minutesAgo: 989 },
          { direction: "in", body: "genial, gracias!", fromAi: false, minutesAgo: 985 },
        ],
        tasks: [] as any[],
      },
    ],
  },
];

async function main() {
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", "demo")
    .maybeSingle();
  if (!company) {
    console.error("Empresa demo no encontrada. Ejecutá primero: npm run db:seed");
    process.exit(1);
  }

  const { data: admin } = await supabase
    .from("company_members")
    .select("*")
    .eq("company_id", company.id)
    .eq("email", "admin@demo.com")
    .maybeSingle();
  if (!admin) {
    console.error("Admin demo no encontrado. Ejecutá primero: npm run db:seed");
    process.exit(1);
  }

  const { data: aiRoles } = await supabase
    .from("ai_roles")
    .select("*")
    .eq("company_id", company.id);
  const roleByKey = Object.fromEntries((aiRoles ?? []).map((r: any) => [r.key, r]));

  const now = new Date();

  for (const contactData of DEMO_CONTACTS) {
    // Check if contact already exists — if so, still backfill any conversation
    // that's missing its messages (covers rows from a prior run of this script
    // before the company_id bug below was fixed).
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", company.id)
      .eq("wa_id", contactData.waId)
      .maybeSingle();

    let contact = existingContact;
    if (!contact) {
      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({ company_id: company.id, wa_id: contactData.waId, name: contactData.name })
        .select()
        .single();
      if (contactError || !newContact) {
        console.error(`Error creando contacto ${contactData.name}:`, contactError);
        continue;
      }
      contact = newContact;
    } else {
      console.log(`Contacto ya existe: ${contactData.name} (${contactData.waId})`);
    }

    for (const convData of contactData.conversations) {
      const aiRole = convData.aiRoleKey ? roleByKey[convData.aiRoleKey] : null;
      const lastMsgMinutesAgo = convData.messages.at(-1)?.minutesAgo ?? 0;

      let { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("company_id", company.id)
        .eq("contact_id", contact.id)
        .maybeSingle();

      if (!conversation) {
        const { data: newConversation, error: convError } = await supabase
          .from("conversations")
          .insert({
            company_id: company.id,
            contact_id: contact.id,
            status: convData.status,
            unread_count: convData.unreadCount,
            ai_role_id: aiRole?.id ?? null,
            assigned_to_id: (convData as any).assignToAdmin ? admin.id : null,
            updated_at: new Date(now.getTime() - lastMsgMinutesAgo * 60 * 1000).toISOString(),
          })
          .select("id")
          .single();
        if (convError || !newConversation) {
          console.error(`Error creando conversación para ${contactData.name}:`, convError);
          continue;
        }
        conversation = newConversation;
      }

      const { count: messageCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation.id);

      if (!messageCount) {
        for (const msg of convData.messages) {
          const createdAt = new Date(now.getTime() - msg.minutesAgo * 60 * 1000).toISOString();
          const { error: msgError } = await supabase.from("messages").insert({
            conversation_id: conversation.id,
            company_id: company.id,
            direction: msg.direction,
            body: msg.body,
            from_ai: msg.fromAi,
            created_at: createdAt,
          });
          if (msgError) console.error(`Error insertando mensaje para ${contactData.name}:`, msgError);
        }
        console.log(`  ↳ ${contactData.name}: ${convData.messages.length} mensajes insertados`);
      }

      const { count: taskCount } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation.id);

      if (!taskCount) {
        for (const taskData of convData.tasks) {
          const dueAt = new Date(now.getTime() + taskData.daysFromNow * 24 * 60 * 60 * 1000).toISOString();
          const { error: taskError } = await supabase.from("tasks").insert({
            company_id: company.id,
            conversation_id: conversation.id,
            title: taskData.title,
            description: taskData.description,
            status: taskData.status,
            assigned_to_id: admin.id,
            created_by_id: admin.id,
            due_at: dueAt,
          });
          if (taskError) console.error(`Error insertando tarea para ${contactData.name}:`, taskError);
        }
      }
    }
  }

  console.log("\nDato de acceso demo:");
  console.log("  email:    admin@demo.com");
  console.log("  password: test1234");
}

main()
  .then(() => {
    console.log("Seed demo completado.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
