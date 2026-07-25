import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { MessagesList } from "./list";

export default async function MessagesPage() {
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: "desc" },
  });

  const unreadCount = messages.filter(m => !m.read).length;

  return (
    <div className="view">
      <PageHeader
        eyebrow="contact form → you"
        title="Inbox"
        description={
          unreadCount > 0
            ? `${unreadCount} unread — everything people send through the site's contact form lands here.`
            : "All caught up. Everything people send through the site's contact form lands here."
        }
      />
      <MessagesList
        messages={messages.map(m => ({
          id: m.id,
          name: m.name,
          email: m.email,
          purpose: m.purpose,
          message: m.message,
          read: m.read,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
