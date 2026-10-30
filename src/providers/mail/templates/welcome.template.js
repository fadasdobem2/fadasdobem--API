/**
 * Boas-vindas após cadastro.
 * @param {string} email E-mail cadastrado
 */
function welcomeEmailHtml(email) {
  const safeEmail = `${email ?? ''}`.trim();
  const accent = '#6b4cff';
  const text = '#1a1726';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bem-vinda</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;background:#f4f4f8;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(40,34,94,0.08);">
          <tr>
            <td style="padding:40px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;font-weight:600;color:${accent};letter-spacing:2px;text-transform:uppercase;">Fadas do Bem</p>
              <h1 style="margin:14px 0 0;font-size:26px;line-height:1.3;color:${text};">Bem-vinda às Fadas do Bem</h1>
              <p style="margin:18px 0 0;font-size:16px;line-height:1.6;color:#5c5c68;">É um prazer ter você aqui. Nossa comunidade existe para guiar suas consultas com <strong style="color:${text};">carinho</strong>, <strong style="color:${text};">segurança</strong> e profissionais de confiança.</p>
              <p style="margin:22px 0 0;font-size:15px;color:#5c5c68;">
                Confirmamos sua conta criada como <strong style="color:${text};">${safeEmail}</strong>.
              </p>
              <div style="margin:28px 0 0;padding:14px 20px;border-radius:999px;display:inline-block;background:linear-gradient(135deg,#6b4cff,#8b7cff);">
                <span style="font-size:14px;font-weight:600;color:#ffffff;">Comece quando quiser</span>
              </div>
              <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#8a8499;">Dúvidas? Nossa equipe está à disposição pelo app e pelos nossos canais oficiais.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 32px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:20px 0 0;font-size:12px;color:#b0aabf;">Mensagem automática • Fadas do Bem</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = welcomeEmailHtml;
