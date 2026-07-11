import { create } from 'zustand';
import { getLLMConfig, setLLMConfig as setLocalLLMConfig, type LLMConfig } from '../services/localLlmService';
import { AppMode, JournalEntry } from '../types';
import { VENDOR_OFFSET_ACCOUNTS } from '../constants';
import { WARBA_VENDOR_OFFSET_ACCOUNTS } from '../warbaConstants';

interface AppState {
  isProcessing: boolean;
  setProcessing: (status: boolean) => void;
  llmConfig: LLMConfig;
  setLLMConfig: (patch: Partial<LLMConfig>) => void;
  getLLMConfig: () => LLMConfig;
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  currentJournalEntries: JournalEntry[];
  setCurrentJournalEntries: (entries: JournalEntry[]) => void;
  vendorOffsetAccounts: { [key: string]: string };
  updateVendorOffsetAccount: (vendor: string, account: string) => void;
  warbaVendorOffsetAccounts: { [key: string]: string };
  updateWarbaVendorOffsetAccount: (vendor: string, account: string) => void;
  aiStatus: string;
  aiModelName: string;
  setAiStatus: (status: string, modelName: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isProcessing: false,
  setProcessing: (status) => set({ isProcessing: status }),
  llmConfig: getLLMConfig(),
  setLLMConfig: (patch) => {
    setLocalLLMConfig(patch);
    set((state) => ({ llmConfig: { ...state.llmConfig, ...patch } }));
  },
  getLLMConfig: () => getLLMConfig(),
  appMode: 'home',
  setAppMode: (mode) => set({ appMode: mode }),
  currentJournalEntries: [],
  setCurrentJournalEntries: (entries) => set({ currentJournalEntries: entries }),
  vendorOffsetAccounts: { ...VENDOR_OFFSET_ACCOUNTS },
  updateVendorOffsetAccount: (vendor, account) => set((state) => ({
    vendorOffsetAccounts: { ...state.vendorOffsetAccounts, [vendor]: account }
  })),
  warbaVendorOffsetAccounts: { ...WARBA_VENDOR_OFFSET_ACCOUNTS },
  updateWarbaVendorOffsetAccount: (vendor, account) => set((state) => ({
    warbaVendorOffsetAccounts: { ...state.warbaVendorOffsetAccounts, [vendor]: account }
  })),
  aiStatus: 'checking',
  aiModelName: '',
  setAiStatus: (status, modelName) => set({ aiStatus: status, aiModelName: modelName }),
}));
