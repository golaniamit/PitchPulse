require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Resend } = require('resend');

// Lazy-init so a missing key doesn't crash the server on startup
let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const FROM = 'PitchPulse <noreply@pitchpulse.co.in>';

async function sendVerificationEmail({ to, username, displayName, token }) {
  const verifyUrl = `${APP_URL}/verify?token=${token}`;
  const name = displayName || username;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f0f0ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0ec;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">
              pitch<span style="color:#00c896;">Pulse</span>
            </p>
            <p style="margin:8px 0 0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.4);">
              Predict · Trade · Win
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">
              Welcome, ${name}! 👋
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              You're one step away from your PitchPulse account. Click the button below to verify your email address and start trading.
            </p>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:8px 0 28px;">
                  <a href="${verifyUrl}"
                     style="display:inline-block;background:#00c896;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:12px;letter-spacing:0.02em;">
                    Verify my account →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;color:#999;line-height:1.6;">
              If the button doesn't work, paste this link into your browser:
            </p>
            <p style="margin:0 0 24px;font-size:12px;color:#00c896;word-break:break-all;">
              ${verifyUrl}
            </p>

            <div style="background:#f8f8f6;border-radius:12px;padding:16px;border-left:3px solid #00c896;">
              <p style="margin:0;font-size:13px;color:#777;line-height:1.6;">
                This link expires in <strong style="color:#1a1a2e;">24 hours</strong>.
                If you didn't create this account, you can safely ignore this email.
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 40px 32px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#ccc;letter-spacing:0.05em;">
              PitchPulse · Live Cricket Markets
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // In development: skip real send, print link to console instead
  if (process.env.NODE_ENV !== 'production') {
    const verifyUrl = `${APP_URL}/verify?token=${token}`;
    console.log('\n─────────────────────────────────────────');
    console.log('📧 DEV MODE — Verification email not sent');
    console.log(`   To: ${to}`);
    console.log(`   Link: ${verifyUrl}`);
    console.log('─────────────────────────────────────────\n');
    return { id: 'dev-mode' };
  }

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Verify your PitchPulse account',
    html,
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

async function sendPasswordResetEmail({ to, username, token }) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f0f0ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0ec;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">
              pitch<span style="color:#00c896;">Pulse</span>
            </p>
            <p style="margin:8px 0 0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.4);">
              Predict · Trade · Win
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Reset your password</p>
            <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
              Hi ${username}, we received a request to reset your PitchPulse password. Click below to choose a new one.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:8px 0 28px;">
                  <a href="${resetUrl}"
                     style="display:inline-block;background:#00c896;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:12px;letter-spacing:0.02em;">
                    Reset password →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#999;line-height:1.6;">
              If the button doesn't work, paste this link into your browser:
            </p>
            <p style="margin:0 0 24px;font-size:12px;color:#00c896;word-break:break-all;">${resetUrl}</p>
            <div style="background:#f8f8f6;border-radius:12px;padding:16px;border-left:3px solid #00c896;">
              <p style="margin:0;font-size:13px;color:#777;line-height:1.6;">
                This link expires in <strong style="color:#1a1a2e;">1 hour</strong>.
                If you didn't request this, you can safely ignore this email — your password won't change.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#ccc;letter-spacing:0.05em;">PitchPulse · Live Cricket Markets</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  if (process.env.NODE_ENV !== 'production') {
    console.log('\n─────────────────────────────────────────');
    console.log('📧 DEV MODE — Password reset email not sent');
    console.log(`   To: ${to}`);
    console.log(`   Link: ${resetUrl}`);
    console.log('─────────────────────────────────────────\n');
    return { id: 'dev-mode' };
  }

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Reset your PitchPulse password',
    html,
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
