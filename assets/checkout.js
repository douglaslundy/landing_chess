(function () {
  const checkout = {
    config: null,
    orderToken: sessionStorage.getItem('checkoutOrderToken'),
    mp: null,
    cardForm: null,
    pollingTimer: null,
    pollingDelay: 4000
  };

  const modal = document.getElementById('checkout-modal');
  const message = document.getElementById('checkout-message');
  const paymentArea = document.getElementById('payment-area');
  const buyerForm = document.getElementById('buyer-form');

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || 'Falha de comunicacao');
    return payload;
  }

  async function loadConfig() {
    if (!checkout.config) checkout.config = await api('/api/config');
    return checkout.config;
  }

  function setMessage(text) {
    message.textContent = text || '';
  }

  function updateVisual(order) {
    const statusTitle = document.getElementById('payment-status-title');
    const statusDetail = document.getElementById('payment-status-detail');
    const emailTitle = document.getElementById('email-status-title');
    const emailDetail = document.getElementById('email-status-detail');
    const labels = {
      created: ['Pedido criado', 'Escolha Pix ou cartao para iniciar o pagamento.'],
      pending: ['Pagamento pendente', 'Aguardando confirmacao oficial do Mercado Pago.'],
      processing: ['Pagamento em processamento', 'O Mercado Pago ainda esta avaliando a transacao.'],
      paid: ['Pagamento confirmado', 'Compra confirmada pelo backend apos consulta oficial ao Mercado Pago.'],
      rejected: ['Pagamento recusado', 'A cobranca foi recusada. Tente outro cartao ou Pix.'],
      cancelled: ['Pagamento cancelado', 'A tentativa foi cancelada ou expirou.'],
      expired: ['Pagamento expirado', 'Gere uma nova tentativa de pagamento.'],
      refunded: ['Pagamento reembolsado', 'Registramos um reembolso posterior.'],
      charged_back: ['Pagamento contestado', 'Registramos uma contestacao posterior.']
    };
    const current = labels[order.status] || ['Status atualizado', order.status];
    statusTitle.textContent = current[0];
    statusDetail.textContent = current[1];

    if (order.emailStatus === 'sent') {
      emailTitle.textContent = 'E-mail enviado pelo SMTP';
      emailDetail.textContent = order.emailSentAt ? `Aceito pelo servidor em ${new Date(order.emailSentAt).toLocaleString('pt-BR')}.` : 'Aceito pelo servidor SMTP.';
    } else if (['pending', 'failed', 'sending'].includes(order.emailStatus)) {
      emailTitle.textContent = 'E-mail em processamento';
      emailDetail.textContent = 'A tarefa de envio esta registrada e sera reprocessada em caso de falha.';
    } else {
      emailTitle.textContent = 'E-mail ainda nao enviado';
      emailDetail.textContent = 'O acesso e enviado apos confirmacao oficial do pagamento.';
    }

    if (order.payment?.qrCode) {
      document.getElementById('pix-box').classList.add('show');
      document.getElementById('pix-code').value = order.payment.qrCode;
      document.getElementById('pix-qr').src = `data:image/jpeg;base64,${order.payment.qrCodeBase64}`;
      document.getElementById('pix-ticket').href = order.payment.ticketUrl || '#';
      document.getElementById('pix-expiration').textContent = order.payment.expiresAt ? `Validade: ${new Date(order.payment.expiresAt).toLocaleString('pt-BR')}` : '';
    }

    const done = ['paid', 'rejected', 'cancelled', 'expired', 'refunded', 'charged_back'].includes(order.status);
    if (done && checkout.pollingTimer) {
      clearTimeout(checkout.pollingTimer);
      checkout.pollingTimer = null;
    }
  }

  async function pollOrder() {
    if (!checkout.orderToken) return;
    try {
      const order = await api(`/api/orders?token=${encodeURIComponent(checkout.orderToken)}`);
      updateVisual(order);
      checkout.pollingDelay = document.hidden ? 15000 : 4000;
    } catch (_) {
      checkout.pollingDelay = Math.min((checkout.pollingDelay || 4000) * 2, 30000);
    }
    if (!checkout.pollingTimer) return;
    checkout.pollingTimer = setTimeout(pollOrder, checkout.pollingDelay);
  }

  function startPolling() {
    if (checkout.pollingTimer) clearTimeout(checkout.pollingTimer);
    checkout.pollingTimer = setTimeout(pollOrder, 1000);
  }

  async function setupCardForm(order) {
    if (checkout.cardForm) return;
    const cfg = await loadConfig();
    checkout.mp = new MercadoPago(cfg.mercadoPagoPublicKey, { locale: 'pt-BR' });
    document.getElementById('form-checkout__cardholderEmail').value = order.buyerEmail;
    checkout.cardForm = checkout.mp.cardForm({
      amount: String((cfg.product.amountCents / 100).toFixed(2)),
      iframe: true,
      form: {
        id: 'card-form',
        cardholderName: { id: 'form-checkout__cardholderName' },
        cardholderEmail: { id: 'form-checkout__cardholderEmail' },
        cardNumber: { id: 'form-checkout__cardNumber' },
        expirationDate: { id: 'form-checkout__expirationDate' },
        securityCode: { id: 'form-checkout__securityCode' },
        installments: { id: 'form-checkout__installments' },
        identificationType: { id: 'form-checkout__identificationType' },
        identificationNumber: { id: 'form-checkout__identificationNumber' },
        issuer: { id: 'form-checkout__issuer' }
      },
      callbacks: {
        onFormMounted: (error) => {
          if (error) setMessage('Nao foi possivel carregar o formulario de cartao.');
        },
        onSubmit: async (event) => {
          event.preventDefault();
          const submit = document.getElementById('card-submit');
          submit.disabled = true;
          setMessage('Enviando pagamento com seguranca...');
          try {
            const data = checkout.cardForm.getCardFormData();
            const paid = await api('/api/payments/card', {
              method: 'POST',
              body: JSON.stringify({
                orderToken: checkout.orderToken,
                token: data.token,
                paymentMethodId: data.paymentMethodId,
                issuerId: data.issuerId,
                installments: data.installments,
                identificationType: data.identificationType,
                identificationNumber: data.identificationNumber
              })
            });
            updateVisual(paid);
            startPolling();
            setMessage('Pagamento enviado. Vamos acompanhar a confirmacao oficial.');
          } catch (error) {
            setMessage(error.message);
          } finally {
            submit.disabled = false;
          }
        },
        onFetching: () => {
          setMessage('Consultando dados do Mercado Pago...');
          return () => setMessage('');
        }
      }
    });
  }

  async function openCheckout(event) {
    event.preventDefault();
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    try {
      await loadConfig();
      if (checkout.orderToken) {
        const order = await api(`/api/orders?token=${encodeURIComponent(checkout.orderToken)}`);
        buyerForm.hidden = true;
        paymentArea.hidden = false;
        updateVisual(order);
        await setupCardForm(order);
        startPolling();
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  document.querySelectorAll('.checkout-link').forEach((link) => {
    link.href = '#checkout';
    link.addEventListener('click', openCheckout);
  });

  document.getElementById('checkout-close').addEventListener('click', () => {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  });

  document.querySelectorAll('.method-tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.method-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.method-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `method-${button.dataset.method}`));
    });
  });

  buyerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('create-order-button');
    submit.disabled = true;
    try {
      const form = new FormData(buyerForm);
      const order = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      checkout.orderToken = order.token;
      sessionStorage.setItem('checkoutOrderToken', order.token);
      buyerForm.hidden = true;
      paymentArea.hidden = false;
      updateVisual(order);
      await setupCardForm(order);
      startPolling();
    } catch (error) {
      setMessage(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('pix-button').addEventListener('click', async () => {
    const button = document.getElementById('pix-button');
    button.disabled = true;
    setMessage('Gerando Pix...');
    try {
      const order = await api('/api/payments/pix', {
        method: 'POST',
        body: JSON.stringify({ orderToken: checkout.orderToken })
      });
      updateVisual(order);
      startPolling();
      setMessage('Pix gerado. Pague no app do banco e aguarde a confirmacao.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('copy-pix').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('pix-code').value);
    setMessage('Codigo Pix copiado.');
  });

  document.addEventListener('visibilitychange', () => {
    if (checkout.orderToken && modal.classList.contains('open')) startPolling();
  });
}());
