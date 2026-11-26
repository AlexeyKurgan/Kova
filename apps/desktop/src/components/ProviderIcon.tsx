import { Sparkles } from "lucide-react";
import BrandIcon from "./BrandIcon";
import { providerBrand } from "../lib/brands";

const ICON_SLUGS: Record<string, string> = {
  openai: "openai",
  codex: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  google: "google",
  gemini: "google",
  vertex: "googlecloud",
  openrouter: "openrouter",
  deepseek: "deepseek",
  xai: "xai",
  zai: "zai",
  mistral: "mistral",
  groq: "groq",
  together: "together",
  fireworks: "fireworks",
  perplexity: "perplexity",
  cohere: "cohere",
  cerebras: "cerebras",
  deepinfra: "deepinfra",
  nebius: "nebius",
  sambanova: "sambanova",
  nvidia: "nvidia",
  moonshot: "moonshot",
  alibaba: "alibaba",
  github: "github",
  ollama: "ollama",
  lmstudio: "lmstudio",
  vllm: "vllm",
  azure: "azure",
  bedrock: "aws",
  aws: "aws",
  qwen: "qwen",
  goose: "goose",
  cursor: "cursor",
};

const MONO_SLUGS = new Set([
  "openai",
  "anthropic",
  "xai",
  "zai",
  "groq",
  "nebius",
  "moonshot",
  "github",
  "ollama",
  "lmstudio",
  "goose",
  "cursor",
]);

type Props = {
  id: string;
  brand?: string;
  size?: number;
};

export default function ProviderIcon({ id, brand, size = 22 }: Props) {
  const slug = ICON_SLUGS[id] ?? (brand ? ICON_SLUGS[brand] : undefined);
  if (slug) {
    return (
      <img
        className={`provider-icon${MONO_SLUGS.has(slug) ? " is-mono" : ""}`}
        src={`/provider-icons/${slug}.svg`}
        width={size}
        height={size}
        alt=""
        loading="lazy"
      />
    );
  }
  const known = providerBrand(id) ?? (brand ? providerBrand(brand) : null);
  if (known) return <BrandIcon name={known} size={size} />;
  return <Sparkles className="provider-fallback-icon" size={size} strokeWidth={1.5} />;
}
