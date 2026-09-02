import { loadConfig } from '../core/config';
import { createOllamaProvider } from './ollamaShared';

export const OllamaProvider = createOllamaProvider(() => loadConfig().ollama, 'OLLAMA_MODEL', false);
