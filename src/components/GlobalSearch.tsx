import React, { useState } from 'react';
import { Search, ChevronDown, ChevronRight, FileCode, GitCommitHorizontal } from 'lucide-react';
import { SearchMatch } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface GlobalSearchProps {
  onOpenFile: (filePath: string, line?: number) => void;
}

interface GitHistoryCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  files: string[];
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onOpenFile }) => {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M1.6: the search panel also searches across git history.
  const [searchMode, setSearchMode] = useState<'files' | 'git'>('files');
  const [gitCommits, setGitCommits] = useState<GitHistoryCommit[]>([]);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) {
      setMatches([]);
      setGitCommits([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      if (searchMode === 'git') {
        // M1.6: search across git history.
        const res = await api.searchGitHistory(query.trim(), 30);
        if (res.success) {
          setGitAvailable(res.isGit);
          setGitCommits(res.commits || []);
        } else {
          setError(res.error || 'History search failed');
        }
      } else {
        const res = await api.searchFiles(query, { caseSensitive, wholeWord, isRegex });
        if (res.success) {
          setMatches(res.matches);
        } else {
          setError(res.error || 'Search failed');
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  // Group matches by filePath
  const grouped = matches.reduce((acc, m) => {
    if (!acc[m.filePath]) acc[m.filePath] = [];
    acc[m.filePath].push(m);
    return acc;
  }, {} as Record<string, SearchMatch[]>);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] text-xs">
      <div className="h-9 px-3 border-b border-[#30363d] flex items-center justify-between select-none shrink-0">
        <span className="font-semibold text-xs tracking-wider uppercase text-[#8b949e]">Search</span>
        <span className="text-[11px] text-[#8b949e]">
          {searchMode === 'git' ? `${gitCommits.length} commits` : `${matches.length} results`}
        </span>
      </div>

      <div className="p-3 border-b border-[#30363d] flex flex-col space-y-2">
        <div className="flex items-center rounded border border-[#30363d] overflow-hidden" role="tablist" aria-label="Search scope">
          <button
            type="button"
            role="tab"
            aria-selected={searchMode === 'files'}
            onClick={() => setSearchMode('files')}
            className={`flex-1 py-1 text-[11px] font-medium transition-colors ${searchMode === 'files' ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
          >
            Files
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={searchMode === 'git'}
            onClick={() => setSearchMode('git')}
            title="Search commits whose diffs contain the term (M1.6)"
            className={`flex-1 py-1 text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${searchMode === 'git' ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white'}`}
          >
            <GitCommitHorizontal size={11} />
            Git history
          </button>
        </div>

        <form onSubmit={handleSearch} className="relative flex items-center">
          <input
            type="text"
            placeholder={searchMode === 'git' ? 'Search across git history...' : 'Search across files...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] focus:border-blue-500 rounded px-2.5 py-1.5 pr-20 text-xs text-white outline-none"
          />

          {searchMode === 'files' && (
            <div className="absolute right-1.5 flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setCaseSensitive(!caseSensitive)}
              aria-label={caseSensitive ? 'Match case off' : 'Match case on'}
              title="Match Case (Alt+C)"
              className={`px-1 py-0.5 rounded text-[11px] font-mono ${
                caseSensitive ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white'
              }`}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setWholeWord(!wholeWord)}
              aria-label={wholeWord ? 'Match whole word off' : 'Match whole word on'}
              title="Match Whole Word (Alt+W)"
              className={`px-1 py-0.5 rounded text-[11px] font-mono ${
                wholeWord ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white'
              }`}
            >
              \b
            </button>
            <button
              type="button"
              onClick={() => setIsRegex(!isRegex)}
              aria-label={isRegex ? 'Regular expression off' : 'Regular expression on'}
              title="Use Regular Expression (Alt+R)"
              className={`px-1 py-0.5 rounded text-[11px] font-mono ${
                isRegex ? 'bg-blue-600 text-white' : 'text-[#8b949e] hover:text-white'
              }`}
            >
              .*
            </button>
          </div>
          )}

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="ml-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-[11px] font-medium"
          >
            {isSearching ? 'Searching…' : searchMode === 'git' ? 'Search history' : 'Search'}
          </button>
        </form>
      </div>

      {/* Results View */}
      <div className="flex-1 overflow-y-auto p-2">
        {error && <div className="text-red-400 p-2 text-xs">{error}</div>}

        {searchMode === 'git' ? (
          gitAvailable === false ? (
            <div className="p-4 text-center text-[#8b949e]">This workspace is not a git repository, so there is no history to search.</div>
          ) : Object.keys(grouped).length === 0 && gitCommits.length === 0 && !isSearching && query ? (
            <div className="p-4 text-center text-[#8b949e]">No commits found for "{query}"</div>
          ) : (
            <div className="flex flex-col space-y-1">
              {gitCommits.map((commit) => (
                <div key={commit.hash} className="px-1.5 py-1.5 hover:bg-[#21262d] rounded">
                  <div className="flex items-center space-x-1.5 text-xs">
                    <GitCommitHorizontal size={12} className="text-amber-400 shrink-0" />
                    <span className="font-mono text-[11px] text-[#8b949e] shrink-0">{commit.hash.slice(0, 8)}</span>
                    <span className="truncate text-[#c9d1d9]">{commit.subject}</span>
                  </div>
                  <div className="pl-[19px] text-[10px] text-[#8b949e] truncate">
                    {commit.author} · {commit.date}
                    {commit.files.length > 0 && <> · {commit.files.slice(0, 3).join(', ')}{commit.files.length > 3 ? ` +${commit.files.length - 3} more` : ''}</>}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          Object.keys(grouped).length === 0 && !isSearching && query ? (
            <div className="p-4 text-center text-[#8b949e]">No results found for "{query}"</div>
          ) : null
        )}

        {searchMode === 'files' && Object.entries(grouped).map(([filePath, fileMatches]) => (
          <div key={filePath} className="mb-3">
            <div className="flex items-center space-x-1.5 py-1 px-1.5 text-xs text-[#58a6ff] font-medium bg-[#161b22] rounded mb-1">
              <FileCode size={13} />
              <span className="truncate">{filePath}</span>
              <span className="text-[10px] text-[#8b949e] ml-auto">({fileMatches.length})</span>
            </div>

            <div className="flex flex-col space-y-0.5 pl-2">
              {fileMatches.map((m, idx) => (
                <div
                  key={`${m.filePath}_${m.lineNumber}_${idx}`}
                  onClick={() => onOpenFile(m.filePath, m.lineNumber)}
                  className="flex items-baseline space-x-2 py-1 px-1.5 hover:bg-[#21262d] rounded cursor-pointer group text-xs"
                >
                  <span className="text-[11px] font-mono text-[#8b949e] group-hover:text-blue-400 shrink-0 w-8 text-right">
                    {m.lineNumber}:
                  </span>
                  <span className="truncate font-mono text-[#c9d1d9] group-hover:text-white">
                    {m.lineContent}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
