import React, { useState, useCallback } from 'react';
import { UploadIcon } from './icons';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  isProcessing: boolean;
  acceptedMimeTypes?: string[];
  acceptedExtensions?: string[];
  description?: string;
}

const defaultMimeTypes = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];
const defaultExtensions = ['.pdf', '.xls', '.xlsx', '.csv'];


const FileUploader: React.FC<FileUploaderProps> = ({ 
  onFilesSelected, 
  isProcessing,
  acceptedMimeTypes = defaultMimeTypes,
  acceptedExtensions = defaultExtensions,
  description = "PDF, Excel, or CSV files"
}) => {
  const [isDragging, setIsDragging] = useState(false);
  
  const filterAcceptedFiles = (files: File[]): File[] => {
    return files.filter(
      (file) =>
        acceptedMimeTypes.includes(file.type) ||
        acceptedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
  };
  
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isProcessing) return;

    const files = filterAcceptedFiles(Array.from(e.dataTransfer.files));
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [isProcessing, onFilesSelected, filterAcceptedFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isProcessing) return;
    const files = filterAcceptedFiles(Array.from(e.target.files || []));
    if (files.length > 0) {
      onFilesSelected(files);
    }
     // Reset input value to allow re-uploading the same file
    e.target.value = '';
  };

  const dragDropClasses = isDragging
    ? 'border-sky-500 bg-sky-900/50'
    : 'border-dark-300 hover:border-sky-600';
    
  const acceptString = [...acceptedMimeTypes, ...acceptedExtensions].join(',');

  return (
    <div
      className={`relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ${dragDropClasses}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        accept={acceptString}
        multiple
        onChange={handleFileChange}
        disabled={isProcessing}
      />
      <label htmlFor="file-upload" className="flex flex-col items-center justify-center text-center p-4">
        <UploadIcon className="w-10 h-10 mb-3 text-slate-400" />
        <p className="font-semibold text-slate-300">
          <span className="text-sky-400">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-slate-500">{description}</p>
      </label>
    </div>
  );
};

export default FileUploader;