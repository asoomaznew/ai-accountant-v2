import React from 'react';
import { type ProcessedFile, FileProcessStatus } from '../types';
import { FileIcon, CheckCircleIcon, XCircleIcon, ClockIcon, QuestionMarkCircleIcon, ArrowRightIcon, SparklesIcon } from './icons';

interface StatusIndicatorProps {
  status: FileProcessStatus;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  switch (status) {
    case FileProcessStatus.Success:
      return <span className="flex items-center text-green-400"><CheckCircleIcon className="w-5 h-5 mr-1.5" /> Success</span>;
    case FileProcessStatus.Error:
      return <span className="flex items-center text-red-400"><XCircleIcon className="w-5 h-5 mr-1.5" /> Error</span>;
    case FileProcessStatus.Processing:
      return <span className="flex items-center text-sky-400 animate-pulse"><SparklesIcon className="w-5 h-5 mr-1.5" /> Processing...</span>;
    case FileProcessStatus.NoMatch:
      return <span className="flex items-center text-yellow-400"><QuestionMarkCircleIcon className="w-5 h-5 mr-1.5" /> No Match</span>;
    case FileProcessStatus.Idle:
    default:
      return <span className="flex items-center text-slate-500"><ClockIcon className="w-5 h-5 mr-1.5" /> Pending</span>;
  }
};

interface ResultsTableProps {
  results: ProcessedFile[];
}

const ResultsTable: React.FC<ResultsTableProps> = ({ results }) => {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center">
        <FileIcon className="w-16 h-16 mb-4" />
        <h3 className="text-xl font-semibold text-slate-400">No files uploaded</h3>
        <p>Upload some PDF files to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto h-full">
      <div className="p-4">
        <h3 className="text-lg font-semibold text-slate-200 mb-2">Processing Results</h3>
      </div>
      <table className="min-w-full divide-y divide-dark-300">
        <thead className="bg-dark-200 sticky top-0">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Original Filename</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">New Filename</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="bg-dark-200 divide-y divide-dark-300">
          {results.map((result) => (
            <tr key={result.id} className="hover:bg-dark-300/50 transition-colors duration-150">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-300 truncate max-w-xs">{result.originalName}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                {result.status === FileProcessStatus.Success && (
                  <div className="flex items-center text-sky-400">
                    <ArrowRightIcon className="w-4 h-4 mr-2 text-slate-500" />
                    <span className="font-medium">{result.newName}</span>
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <StatusIndicator status={result.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ResultsTable;