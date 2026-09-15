(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || sessionStorage.getItem('checkoutOrderToken');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const buyer = document.getElementById('buyer');
  const emailStatus = document.getElementById('email-status');
  const accessButton = document.getElementById('access-button');
  let timer = null;
  let delay = 4000;

  async function loadOrder() {
    if (!token) throw new Error('Não foi possível localizar o acompanhamento desta compra.');
    const response = await fetch(`/api/orders?token=${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Não foi possível consultar o pedido.');
    return payload;
  }

  function update(order) {
    buyer.hidden = false;
    buyer.textContent = `Compra registrada para ${order.buyerName}.`;

    if (order.status === 'paid' && order.accessUrl) {
      title.textContent = 'Pagamento confirmado';
      message.textContent = `Pronto, ${order.buyerName}. O produto foi enviado para ${order.buyerEmail}.`;
      emailStatus.textContent = order.emailStatus === 'sent'
        ? 'O e-mail foi aceito pelo servidor de envio.'
        : 'O e-mail está sendo processado. O botão abaixo já dá acesso ao produto.';
      emailStatus.className = 'status';
      accessButton.href = order.accessUrl;
      accessButton.setAttribute('aria-disabled', 'false');
      if (timer) clearTimeout(timer);
      timer = null;
      return;
    }

    const messages = {
      rejected: 'O pagamento foi recusado. Volte à página inicial para tentar novamente.',
      cancelled: 'O pagamento foi cancelado. Volte à página inicial para iniciar outra tentativa.',
      expired: 'O pagamento expirou. Volte à página inicial para gerar uma nova cobrança.',
      refunded: 'Este pagamento foi reembolsado. O acesso não está disponível.',
      charged_back: 'Este pagamento foi contestado. O acesso não está disponível.'
    };
    title.textContent = order.status === 'processing' ? 'Pagamento em análise' : 'Acompanhando pagamento';
    message.textContent = messages[order.status] || 'A confirmação oficial ainda está sendo processada.';
    emailStatus.textContent = 'Assim que o Mercado Pago confirmar o pagamento, esta página será atualizada.';
    emailStatus.className = 'status';
    if (!['rejected', 'cancelled', 'expired', 'refunded', 'charged_back'].includes(order.status)) {
      timer = setTimeout(poll, delay);
    }
  }

  async function poll() {
    try {
      const order = await loadOrder();
      delay = 4000;
      update(order);
    } catch (error) {
      emailStatus.textContent = error.message;
      emailStatus.className = 'status error';
      delay = Math.min(delay * 2, 30000);
      timer = setTimeout(poll, delay);
    }
  }

  if (token) sessionStorage.setItem('checkoutOrderToken', token);
  poll();
}());
