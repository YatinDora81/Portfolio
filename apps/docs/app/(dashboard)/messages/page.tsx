import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { MessagesList } from "./list";

export default async function MessagesPage() {
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: "desc" },
  });

  const unreadCount = messages.filter(m => !m.read).length;

  return (
    <div>
      <PageHeader
        title="Messages"
        description={unreadCount > 0 ? `${unreadCount} unread message${unreadCount > 1 ? "s" : ""}` : "All caught up"}
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
