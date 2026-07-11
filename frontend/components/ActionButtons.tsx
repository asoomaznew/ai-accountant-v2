import React from 'react';
import { EyeIcon, DocumentArrowDownIcon, SparklesIcon, XCircleIcon } from './icons';

interface ActionButtonsProps {
  onPreview: () => void;
  onDownload: () => void;
  onClear: () => void;
  isProcessing: boolean;
  hasFiles: boolean;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({ onPreview, onDownload, onClear, isProcessing, hasFiles }) => {
  const baseClasses = "w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-dark-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const primaryClasses = "text-white bg-sky-600 hover:bg-sky-700 focus:ring-sky-500";
  const secondaryClasses = "text-sky-300 bg-sky-900/50 border-sky-800 hover:bg-sky-900 focus:ring-sky-700";
  const tertiaryClasses = "text-slate-400 hover:bg-dark-300 hover:text-slate-200";

  return (
    <div className="space-y-4">
      <button
        onClick={onPreview}
        disabled={isProcessing || !hasFiles}
        className={`${baseClasses} ${secondaryClasses}`}
      >
        <EyeIcon className="-ml-1 mr-2 h-5 w-5" />
        Preview Renaming
      </button>

      <button
        onClick={onDownload}
        disabled={isProcessing || !hasFiles}
        className={`${baseClasses} ${primaryClasses}`}
      >
        <DocumentArrowDownIcon className="-ml-1 mr-2 h-5 w-5" />
        Process & Download ZIP
      </button>

      <button
        onClick={onClear}
        disabled={isProcessing || !hasFiles}
        className={`${baseClasses} ${tertiaryClasses} border-none shadow-none text-sm py-2`}
      >
        <XCircleIcon className="-ml-1 mr-2 h-5 w-5" />
        Clear All Files
      </button>
    </div>
  );
};

export default ActionButtons;