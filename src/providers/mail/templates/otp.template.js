/**
 * Template HTML — recuperação de senha com código OTP.
 * @param {string} code Código numérico (6 dígitos)
 * @param {string} expiresIn Texto humanizado (ex: "10 minutos")
 */
function otpEmailHtml(code, expiresIn) {
  const safeCode = `${code ?? ''}`.trim();
  const safeExpires = `${expiresIn ?? 'alguns minutos'}`.trim();
  const brand = '#6b4cff';
  const muted = '#5c5c68';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Redefinição de senha</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;background:#f4f4f8;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(40,34,94,0.08);">
          <tr>
            <td style="padding:36px 32px 8px;text-align:center;">
              <p style="margin:0;font-size:12px;font-weight:600;color:${brand};letter-spacing:2px;text-transform:uppercase;">Fadas do Bem</p>
              <h1 style="margin:12px 0 0;font-size:24px;line-height:1.25;color:#1a1726;">Recuperação de senha</h1>
              <p style="margin:16px 0 0;font-size:16px;line-height:1.55;color:${muted};">Use o código abaixo para continuar — ele expira em <strong style="color:#1a1726;">${safeExpires}</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 36px;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#f0edff,#ffffff);border:2px dashed ${brand}33;border-radius:12px;padding:20px 32px;margin:8px auto;">
                <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#1a1726;font-family:'SF Mono',Consolas,monospace;">${safeCode}</span>
              </div>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8a8499;">Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual permanece segura.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:20px 0 0;font-size:12px;color:#b0aabf;">Este é um e-mail automático. Obrigada por escolher a Fadas do Bem.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = otpEmailHtml;
