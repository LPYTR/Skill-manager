import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Heart, Library, LoaderCircle, Moon, RefreshCw, Search, Sun, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from './api';
import type { Skill } from '../src/core/types';
import { guideFor } from './guides';

export default function App() {
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('skill-manager-theme') || 'light');
  const search = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  async function load() {
    setLoading(true); setError('');
    try { setItems(await api<Skill[]>('skills')); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('skill-manager-theme', theme); }, [theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'Escape' && selected) { setSelected(null); returnFocus.current?.focus(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [selected]);
  useEffect(() => { if (selected) close.current?.focus(); }, [selected]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  const visible = useMemo(() => items.filter(item => {
    if (favoriteOnly && !item.favorite) return false;
    const guide = guideFor(item);
    const text = [item.name, guide.description, guide.task, item.description, item.body, item.notes, ...item.tags].join(' ').toLocaleLowerCase();
    return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
  }).sort((a,b) => a.name.localeCompare(b.name, 'zh-CN')), [items, query, favoriteOnly]);
  const detail = items.find(item => item.id === selected);
  const guide = detail ? guideFor(detail) : null;
  function navigate(favorites: boolean) { setFavoriteOnly(favorites); setQuery(''); setSelected(null); }
  async function toggleFavorite(item: Skill) {
    if (saving.has(item.id)) return;
    setSaving(previous => new Set(previous).add(item.id));
    try {
      await api(`skills/${item.id}`, { favorite: !item.favorite }, 'PATCH');
      setItems(previous => previous.map(value => value.id === item.id ? { ...value, favorite: !item.favorite } : value));
      setNotice(item.favorite ? '已取消收藏' : '已加入个人收藏');
    } catch (e) { setNotice(e instanceof Error ? e.message : '收藏失败'); }
    finally { setSaving(previous => { const next = new Set(previous); next.delete(item.id); return next; }); }
  }
  async function copyPrompt() {
    if (!guide) return;
    try { await navigator.clipboard.writeText(guide.prompt); setNotice('调用提示词已复制'); }
    catch { setNotice('复制失败，请选中提示词手动复制'); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate(false); }}><span className="brand-mark"><Library size={22}/></span><span>Skill Manager<small>找到能力，知道怎么用</small></span></a>
      <nav aria-label="技能库"><button className={`nav-item ${!favoriteOnly ? 'selected' : ''}`} aria-current={!favoriteOnly ? 'page' : undefined} onClick={() => navigate(false)}><Library size={18}/>所有技能<span>{items.length}</span></button><button className={`nav-item ${favoriteOnly ? 'selected' : ''}`} aria-current={favoriteOnly ? 'page' : undefined} onClick={() => navigate(true)}><Heart size={18}/>个人收藏<span>{items.filter(item => item.favorite).length}</span></button></nav>
      <p className="sidebar-note">查找想做的事，<br/>把调用提示词交给 AI。</p>
    </aside>
    <main className="workspace">
      <header className="toolbar"><span>我的技能库</span><div><button className="icon-button" aria-label="刷新技能库" disabled={loading} onClick={() => void load()}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button><button className="icon-button" aria-label={theme === 'light' ? '切换深色外观' : '切换浅色外观'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button></div></header>
      <div className="workspace-columns"><section className="collection" aria-label="技能列表">
        <div className="page-heading"><h1>{favoriteOnly ? '个人收藏' : '所有技能'}</h1><p>{favoriteOnly ? '常用的能力，随时回来找。' : '每个技能能做什么、怎么用，在这里一目了然。'}</p></div>
        <label className="search"><Search size={19}/><input ref={search} aria-label="搜索技能" placeholder="搜索技能，或想做的事，例如：设计网页、制作视频" value={query} onChange={e => setQuery(e.target.value)}/>{query ? <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={16}/></button> : <kbd>Ctrl K</kbd>}</label>
        <div className="list-caption">{query ? '搜索结果' : favoriteOnly ? '已收藏' : '全部技能'} · {visible.length} 项</div>
        {error ? <div className="empty" role="alert"><h2>暂时无法读取技能库</h2><p>{error}</p><button className="button" onClick={() => void load()}>重新加载</button></div> : loading && !items.length ? <div className="empty" role="status"><LoaderCircle className="spin"/> 正在读取技能库…</div> : !visible.length ? <div className="empty"><Search size={28}/><h2>{query ? '没有找到相关技能' : '还没有收藏'}</h2><p>{query ? '试试其他中文用途或技能名称。' : '点击技能旁的爱心，把常用能力留在这里。'}</p></div> : <div className="skills-list">{visible.map(item => {
          const itemGuide = guideFor(item);
          return <article className={`skill-row ${selected === item.id ? 'is-selected' : ''}`} key={item.id}><button className="skill-select" aria-label={`查看 ${item.name}`} onClick={event => { returnFocus.current = event.currentTarget; setSelected(item.id); }}><span className="glyph">{item.name.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').slice(0,2).toUpperCase()}</span><span className="skill-copy"><strong>{item.name}</strong><span>{itemGuide.description}</span></span></button><button className={`icon-button favorite ${item.favorite ? 'is-favorite' : ''}`} disabled={saving.has(item.id)} aria-pressed={item.favorite} aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`} onClick={() => void toggleFavorite(item)}><Heart size={18} fill={item.favorite ? 'currentColor' : 'none'}/></button></article>;
        })}</div>}
      </section>
      {detail && guide && <aside className="inspector" aria-label="Skill 详情"><div className="inspector-toolbar"><span>使用指南</span><button ref={close} className="icon-button" aria-label="关闭详情" onClick={() => { setSelected(null); returnFocus.current?.focus(); }}><X size={19}/></button></div><div className="detail-content"><h2>{detail.name}</h2><p className="detail-description">{guide.description}</p><section className="guide-section"><h3>什么时候用</h3><p>{guide.task}</p></section><section className="guide-section"><h3>怎么调用</h3><p>在已加载这个技能的 AI 工具中，发送下面这段话，再补充你的材料和具体要求。</p><pre className="prompt">{guide.prompt}</pre><button className="button primary" onClick={() => void copyPrompt()}><Copy size={15}/>复制调用提示词</button></section><section className="guide-section"><h3>开始前准备</h3><p>{guide.preparation}</p></section>{detail.notes && <section className="guide-section"><h3>已有备注</h3><p>{detail.notes}</p></section>}<details className="original"><summary>查看原始说明</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({alt}) => <span>[图片：{alt || '资源文件'}]</span>, a: ({href,children}) => <a href={href && /^https?:\/\//.test(href) ? href : undefined} target="_blank" rel="noreferrer">{children}</a> }}>{`## 原始描述\n${detail.description}\n\n${detail.body}`}</ReactMarkdown></div></details></div></aside>}
      </div>
    </main>
    {notice && <div className="notification" role="status"><Check size={17}/>{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </div>;
}
