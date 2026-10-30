/**
 * @param {string} verificationUrl URL absoluto com token
 */
module.exports = function verifyEmailHtml(verificationUrl) {
  return `
<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#222">
  <p>Olá,</p>
  <p>Confirme o seu e-mail clicando no link abaixo. O link expira em <strong>24 horas</strong> e só pode ser usado uma vez.</p>
  <p><a href="${verificationUrl}" style="display:inline-block;padding:12px 20px;background:#5b3ea8;color:#fff;text-decoration:none;border-radius:8px">Confirmar e-mail</a></p>
  <p>Ou copie e cole no navegador:</p>
  <p style="word-break:break-all;font-size:14px;color:#444">${verificationUrl}</p>
  <p style="margin-top:2rem;font-size:13px;color:#666">— Fadas do Bem</p>
</body></html>`;
};
