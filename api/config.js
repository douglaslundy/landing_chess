const { method, sendJson } = require('./_lib/http');
const { publicConfig } = require('./_lib/env');
const { PRODUCT } = require('./_lib/constants');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    sendJson(res, 200, {
      ...publicConfig(),
      product: {
        title: PRODUCT.title,
        amountCents: PRODUCT.amountCents,
        currency: PRODUCT.currency
      },
      polling: {
        initialMs: 4000,
        inactiveMs: 15000
      }
    });
  } catch (error) {
    sendJson(res, 500, { error: error.code || 'configuration_error', message: error.message });
  }
};
