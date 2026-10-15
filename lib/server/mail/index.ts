export {
  MAIL_CATEGORIES,
  sendMail,
  type MailActor,
  type MailCategory,
  type SendMailInput,
  type SendMailResult,
} from "./send";
export { appEmailSender, emailConfigured, formatSender, missingApiKeyMessage, senderAddress } from "./transport";
export { mailBrandFor, mailIdentityFor, platformMailIdentity, type MailIdentity } from "./org-brand";
export {
  PLATFORM_BRAND,
  mailLogoUrl,
  renderMail,
  renderMailText,
  type MailBrand,
  type MailContact,
  type MailContent,
  type MailCta,
  type MailRow,
} from "./template";
export {
  buildBudgetMail,
  budgetPrintSheetUrl,
  type BudgetMailBudget,
  type BudgetMailContent,
  type BudgetMailInput,
  type BudgetMailItem,
} from "./budget";
export {
  buildInvitationMail,
  type InvitationMailContent,
  type InvitationMailInput,
} from "./invitation";
export {
  buildSignatureCompletedMail,
  buildSignatureOtpMail,
  buildSignatureReminderMail,
  buildSignatureRequestMail,
  signatureDueText,
  type SignatureCompletedMailInput,
  type SignatureOtpMailInput,
  type SignatureReminderMailInput,
  type SignatureRequestMailContent,
  type SignatureRequestMailInput,
} from "./signature";
