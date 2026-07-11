import React from 'react';
import { JournalEntry } from '../types';
import { SearchIcon } from './icons';

interface JournalEntryTableProps {
    entries: JournalEntry[];
    headers: string[];
    searchTerm: string;
    onSearchChange: (term: string) => void;
}

const JournalEntryTable: React.FC<JournalEntryTableProps> = ({ entries, headers, searchTerm, onSearchChange }) => {
    return (
        <div className="bg-dark-300/50 p-4 rounded-lg border border-dark-300 animate-fade-in">
            <div className="relative mb-4">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                    <SearchIcon className="w-5 h-5 text-slate-400" />
                </span>
                <input
                    type="search"
                    placeholder="Search entries..."
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-md bg-dark-300 text-slate-200 border border-slate-600 focus:ring-sky-500 focus:border-sky-500 transition-colors"
                    aria-label="Search journal entries"
                />
            </div>
            <div className="overflow-auto" style={{ maxHeight: '350px' }}>
                <table className="min-w-full text-sm text-left text-slate-300">
                    <thead className="text-xs text-sky-400 uppercase bg-dark-300/50 sticky top-0 backdrop-blur-sm">
                        <tr>
                            {headers.map(header => (
                                <th key={header} scope="col" className="px-4 py-2 whitespace-nowrap">{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-300">
                        {entries.slice(0, 100).map((entry, index) => (
                            <tr key={index} className="hover:bg-dark-300">
                              <td className="px-4 py-2 whitespace-nowrap">{entry.journalNumber}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.journalName}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.lineNum}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.postingDate}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.accountType}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.accountNo}</td>
                              <td className="px-4 py-2 truncate max-w-xs" title={entry.description}>{entry.description}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.debitAmount}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.creditAmount}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.currencyCode}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.exchangeRate}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.offsetAccountType}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.offsetAccount}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.invoiceNo}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.documentNo}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.documentDate}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.dueDate}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.assetTransType}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.postingProfile}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.paymentMode}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.paymentReference}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.numberOfVoucher}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.activities}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.country}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.departments}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.projectId}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{entry.propertyId}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {entries.length > 100 && <p className="text-xs text-slate-500 text-center pt-2">Showing first 100 of {entries.length} matching entries...</p>}
            {entries.length === 0 && searchTerm && (
                <p className="text-center text-slate-400 py-4">No entries match your search.</p>
            )}
        </div>
    );
};

export default JournalEntryTable;