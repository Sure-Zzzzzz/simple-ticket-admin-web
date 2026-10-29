const clientId = process.env.VITE_TICKET_PKCE_CLIENT_ID?.trim();

if (!clientId) {
  console.error('缺少 VITE_TICKET_PKCE_CLIENT_ID：Ticket Web 构建必须注入已登记的公开 OAuth 客户端标识。');
  process.exit(1);
}
