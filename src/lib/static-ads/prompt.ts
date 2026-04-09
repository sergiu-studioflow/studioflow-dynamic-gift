/**
 * Resolve template variables in a master prompt.
 *
 * Supported variables:
 *   {{product_name}}        — Product name
 *   {{product_description}} — Product solution/description
 *   {{target_audience}}     — Product target audience
 *
 * Extensible for v2 (user overrides, AI-enhanced prompts, etc.)
 */
export function resolvePrompt(
  masterPrompt: string,
  vars: {
    productName?: string;
    productDescription?: string;
    targetAudience?: string;
  }
): string {
  return masterPrompt
    .replace(/\{\{product_name\}\}/gi, vars.productName || "")
    .replace(/\{\{product_description\}\}/gi, vars.productDescription || "")
    .replace(/\{\{target_audience\}\}/gi, vars.targetAudience || "");
}
