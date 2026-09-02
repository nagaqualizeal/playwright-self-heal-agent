import { loadConfig } from '../core/config';
import { createOllamaProvider } from './ollamaShared';

export const OllamaLocalProvider = createOllamaProvider(() => loadConfig().ollamaLocal, 'OLLAMA_LOCAL_MODEL', false);
