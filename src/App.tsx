import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, Circle, Clock, Plus, Trash2, Bell, Search, Moon, Sun,
  LayoutDashboard, ListTodo, CalendarDays, Target, Sparkles, Command,
  BellRing, LogOut, Mail, Lock, User as UserIcon, X, Tag, AlignLeft, 
  ChevronRight, ArrowRight, XCircle, Settings, Volume2, ShieldAlert
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'pending' | 'completed';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  status: Status;
  createdAt: string;
}

const CATEGORIES = ["Geral", "Trabalho", "Pessoal", "Estudos"];

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks'>('dashboard');
  const [filterCategory, setFilterCategory] = useState<string>('Todas');
  const [search, setSearch] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>('default');
  const [toastMsg, setToastMsg] = useState<{title: string, message: string} | null>(null);
  
  // Profile State
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profName, setProfName] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar] = useState<string | null>(null);

  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState<string>('Geral');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(localStorage.getItem('tm_token'));
  
  // Auth state
  const [isLogin, setIsLogin] = useState(true);
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const savedUser = localStorage.getItem('tm_user');
    if (savedUser && token) {
      setCurrentUser(JSON.parse(savedUser));
    }
    const savedConfig = localStorage.getItem('tm_config');
    if (savedConfig) {
       const parsed = JSON.parse(savedConfig);
       if (parsed.sound !== undefined) setConfigSound(parsed.sound);
       if (parsed.confirmDelete !== undefined) setConfigConfirmDelete(parsed.confirmDelete);
       if (parsed.showCompleted !== undefined) setConfigShowCompleted(parsed.showCompleted);
    }

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true);
    }
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const saveConfig = (newCfg: any) => {
     const merged = { sound: configSound, confirmDelete: configConfirmDelete, showCompleted: configShowCompleted, ...newCfg };
     setConfigSound(merged.sound);
     setConfigConfirmDelete(merged.confirmDelete);
     setConfigShowCompleted(merged.showCompleted);
     localStorage.setItem('tm_config', JSON.stringify(merged));
  };

  const playSuccessSound = () => {
    if (!configSound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch(e) {}
  };

  const authHeaders = {
    'Content-Type': 'application/json',
    'x-user-id': token || ''
  };

  useEffect(() => {
    if (!token) return;
    fetch('/api/tasks', { headers: authHeaders })
      .then(res => res.json())
      .then(data => {
         if (Array.isArray(data)) setTasks(data);
      })
      .catch(err => console.error('Failed to load tasks:', err));
  }, [token]);

  useEffect(() => {
    if (notifPerm === 'granted') return;
    if ('Notification' in window) {
      setNotifPerm(Notification.permission);
      if (Notification.permission === 'default') {
        const timer = setTimeout(() => {
          Notification.requestPermission().then(setNotifPerm);
        }, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const showToast = (title: string, message: string) => {
    setToastMsg({title, message});
    setTimeout(() => setToastMsg(null), 4000);
  };

  const syncNotify = (title: string, body: string) => {
    if (notifPerm === 'granted') {
      new Notification(title, { body });
    }
    showToast(title, body);
  };

  // --- Auth Handlers ---
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin 
      ? { email: authEmail, password: authPassword }
      : { name: authName, email: authEmail, password: authPassword };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (!res.ok) {
        setAuthError(data.error || 'Erro de autenticação');
        return;
      }
      
      setCurrentUser(data.user);
      setToken(data.token);
      localStorage.setItem('tm_user', JSON.stringify(data.user));
      localStorage.setItem('tm_token', data.token);
      setAuthName('');
      setAuthEmail('');
      setAuthPassword('');
      syncNotify('Bem-vindo', `Olá, ${data.user.name}!`);
    } catch(err) {
      setAuthError('Falha na comunicação com servidor.');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setToken(null);
    setTasks([]);
    localStorage.removeItem('tm_user');
    localStorage.removeItem('tm_token');
    setActiveTab('dashboard');
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Erro ao recuperar senha');
      } else {
        syncNotify('Recuperação', data.message);
        setIsRecovering(false);
        setRecoverEmail('');
      }
    } catch(err) {
      setAuthError('Falha no servidor.');
    }
  };

  const openProfile = () => {
    setProfName(currentUser?.name || '');
    setProfEmail(currentUser?.email || '');
    setProfPassword('');
    setProfAvatar(currentUser?.avatar || null);
    setShowProfileForm(true);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setProfAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ name: profName, email: profEmail, password: profPassword, avatar: profAvatar })
      });
      const data = await res.json();
      if (!res.ok) {
        syncNotify("Erro", data.error || "Falha ao atualizar perfil");
      } else {
        setCurrentUser(data.user);
        localStorage.setItem('tm_user', JSON.stringify(data.user));
        syncNotify("Sucesso", "Seu perfil foi atualizado!");
        setShowProfileForm(false);
      }
    } catch(err) {
      syncNotify("Erro", "Erro no servidor.");
    }
  };

  // --- Task Operations ---
  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;
    
    if (isPast(new Date(formDate))) {
      syncNotify("Atenção", "A data estipulada já passou.");
    }

    const taskData = {
      title: formTitle,
      description: formDesc,
      dueDate: new Date(formDate).toISOString(),
      priority: formPriority,
      category: formCategory
    };

    try {
      if (editingTaskId) {
        const res = await fetch(`/api/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(taskData)
        });
        const updatedTask = await res.json();
        setTasks(tasks.map(t => t.id === editingTaskId ? updatedTask : t));
        syncNotify("Atualizada", "Sua tarefa foi modificada com sucesso.");
      } else {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(taskData)
        });
        const savedTask = await res.json();
        setTasks([...tasks, savedTask]);
        syncNotify("Sucesso", "Nova tarefa criada!");
      }
      resetForm();
    } catch(err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormPriority('medium');
    setFormCategory('Geral');
    setEditingTaskId(null);
    setShowTaskForm(false);
  };

  const handleNewTaskInit = () => {
    resetForm();
    setShowTaskForm(true);
  };

  const handleEditInit = (task: Task) => {
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(task.dueDate.slice(0, 16));
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setEditingTaskId(task.id);
    setShowTaskForm(true);
  };

  const toggleTaskStatus = async (task: Task) => {
    const newStatus = task.status === 'pending' ? 'completed' : 'pending';
    try {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error();
      if (newStatus === 'completed') {
        playSuccessSound();
        syncNotify("Parabéns!", `A tarefa "${task.title}" foi concluída.`);
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
    }
  };

  const deleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (configConfirmDelete && !window.confirm("Certeza que deseja excluir esta tarefa permanentemente?")) {
      return;
    }
    
    try {
        setTasks(prev => prev.filter(t => t.id !== id));
        await fetch(`/api/tasks/${id}`, {
          method: 'DELETE',
          headers: authHeaders
        });
        syncNotify("Removida", "A tarefa foi deletada.");
    } catch(err) {
      console.error(err);
    }
  };

  // Formatted & Filtered Data
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  
  const filteredTasks = pendingTasks.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === 'Todas' || t.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const totalTasks = tasks.length;
  const completedCount = completedTasks.length;
  const todayCount = pendingTasks.filter(t => isToday(parseISO(t.dueDate))).length;
  const overdueCount = pendingTasks.filter(t => isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate))).length;

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {/* Simple Login Screen */}
        <div className="max-w-md w-full glass-panel rounded-3xl p-8 shadow-2xl relative overflow-hidden bg-white dark:bg-[#0a122a]">
           <div className="text-center mb-8">
             <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
               <Target size={32} />
             </div>
             <h1 className="text-2xl font-display font-bold">TaskMaster</h1>
             <p className="text-slate-500 mt-2">{isLogin ? 'Faça login para continuar' : 'Crie sua conta'}</p>
           </div>
           
           {isRecovering ? (
             <form onSubmit={handleRecover} className="space-y-4">
               <p className="text-sm text-slate-500 text-center mb-4">Insira seu email para recuperar sua senha.</p>
               <div className="relative">
                 <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input required type="email" placeholder="Email" value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
               {authError && <p className="text-rose-500 text-sm font-medium text-center">{authError}</p>}
               <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                 Enviar Link de Recuperação
               </button>
               <div className="text-center mt-4">
                 <button type="button" onClick={() => { setIsRecovering(false); setAuthError(''); }} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm font-bold">Voltar para o Login</button>
               </div>
             </form>
           ) : (
             <form onSubmit={handleAuth} className="space-y-4">
               {!isLogin && (
                 <div className="relative">
                   <UserIcon size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input required type="text" placeholder="Seu nome" value={authName} onChange={e => setAuthName(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                 </div>
               )}
               <div className="relative">
                 <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input required type="email" placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
               <div className="relative">
                 <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input required type="password" placeholder="Senha" value={authPassword} onChange={e => setAuthPassword(e.target.value)} className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
               {isLogin && (
                 <div className="text-right">
                   <button type="button" onClick={() => { setIsRecovering(true); setAuthError(''); }} className="text-blue-600 text-sm font-semibold hover:underline">Esqueceu a senha?</button>
                 </div>
               )}
               {authError && <p className="text-rose-500 text-sm font-medium text-center">{authError}</p>}
               <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                 {isLogin ? 'Entrar' : 'Registrar'}
               </button>
             </form>
           )}
           
           {!isRecovering && (
             <p className="mt-6 text-center text-slate-500 text-sm">
               {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
               <button onClick={() => { setIsLogin(!isLogin); setAuthError(''); }} className="text-blue-600 font-bold hover:underline">
                 {isLogin ? 'Registre-se' : 'Faça login'}
               </button>
             </p>
           )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#02040a] text-slate-900 dark:text-slate-100 overflow-hidden font-sans selection:bg-blue-500/30">
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 h-full border-r border-slate-200/60 dark:border-white/5 bg-white/50 dark:bg-[#0a0f1e]/80 backdrop-blur-xl shrink-0 p-6">
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-sky-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Target size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight">TaskMaster</h1>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20}/>} label="Dashboard" />
          <SidebarItem active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<ListTodo size={20}/>} label="Minhas Tarefas" badge={pendingTasks.length} />
          
          <div className="pt-8 pb-3 px-3">
             <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Categorias</h3>
          </div>
          <div className="space-y-1">
             <FilterTag active={filterCategory === 'Todas'} onClick={() => { setFilterCategory('Todas'); setActiveTab('tasks'); }} label="Todas" count={pendingTasks.length} />
             {CATEGORIES.map(cat => (
               <FilterTag key={cat} active={filterCategory === cat} onClick={() => { setFilterCategory(cat); setActiveTab('tasks'); }} label={cat} count={pendingTasks.filter(t => t.category === cat).length} />
             ))}
          </div>
        </nav>

        <div className="mt-auto pt-6">
          <div onClick={openProfile} className="bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer transition-colors rounded-2xl p-4 flex items-center gap-3 mb-4">
             {currentUser?.avatar ? (
               <img src={currentUser.avatar} alt="Avatar" className="w-10 h-10 rounded-full object-cover shadow-sm" />
             ) : (
               <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                 <UserIcon size={20} />
               </div>
             )}
             <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{currentUser?.name}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest truncate">{currentUser?.email}</p>
             </div>
             <button onClick={(e) => { e.stopPropagation(); handleLogout(); }} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0" title="Sair">
                <LogOut size={18} />
             </button>
          </div>
          
          <div className="px-2">
             <button onClick={() => setShowSettings(!showSettings)} className="flex items-center justify-between w-full text-left text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors">
               <span className="text-sm font-medium flex items-center gap-2">
                 <Settings size={16} /> Configurações
               </span>
               <ChevronRight size={16} className={cn("transition-transform duration-300", showSettings && "rotate-90")} />
             </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-transparent">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-slate-200/60 dark:border-white/5 bg-white/70 dark:bg-[#0a0f1e]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <Target size={24} className="text-blue-500" />
            <h1 className="font-display font-bold text-lg">TaskMaster</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors">
               <Settings size={20} />
            </button>
            <button onClick={openProfile} className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border-2 border-transparent hover:border-blue-500 transition-all overflow-hidden relative">
              {currentUser?.avatar ? (
                <img src={currentUser.avatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserIcon size={16} />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-10 max-w-7xl w-full mx-auto pb-28 md:pb-10">
           
           <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
             <div>
               <h2 className="text-3xl font-display font-bold mb-1">
                 {activeTab === 'dashboard' ? `Olá, ${currentUser?.name.split(' ')[0]}` : 'Suas Atividades'}
               </h2>
               <p className="text-slate-500 dark:text-slate-400">
                 {activeTab === 'dashboard' ? 'Aqui está o panorama do seu dia.' : 'Gerencie e organize suas prioridades.'}
               </p>
             </div>
             {activeTab === 'tasks' && (
               <button 
                 onClick={handleNewTaskInit}
                 className="hidden md:flex items-center gap-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 px-6 py-3 rounded-2xl transition-all font-semibold shadow-xl active:scale-95"
               >
                 <Plus size={20} />
                 <span>Nova Tarefa</span>
               </button>
             )}
           </div>

           <AnimatePresence mode="wait">
             {activeTab === 'dashboard' && (
               <motion.div key="dash" initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}} className="space-y-10">
                 
                 <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                   <MetricCard title="Total" value={totalTasks} icon={<Target />} />
                   <MetricCard title="Feitas" value={completedCount} icon={<CheckCircle2 />} />
                   <MetricCard title="Hoje" value={todayCount} icon={<CalendarDays />} />
                   <MetricCard title="Atraso" value={overdueCount} icon={<Bell />} error />
                 </div>

                 <div className="grid lg:grid-cols-3 gap-6">
                   <div className="lg:col-span-2 space-y-6">
                     <div className="flex items-center justify-between">
                       <h3 className="text-xl font-display font-semibold">Prioridades Pendentes</h3>
                       <button onClick={() => setActiveTab('tasks')} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">Ver todas <ArrowRight size={16}/></button>
                     </div>
                     <div className="bg-white/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-[2rem] p-4 flex flex-col gap-3">
                       {pendingTasks.slice(0, 5).map((task) => (
                         <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} compact />
                       ))}
                       {pendingTasks.length === 0 && (
                         <div className="py-16 text-center flex flex-col items-center justify-center opacity-60">
                           <CheckCircle2 size={40} className="mb-4 text-emerald-500" />
                           <p className="font-medium text-lg">Nenhuma pendência prioritária.</p>
                         </div>
                       )}
                     </div>
                   </div>

                   <div className="lg:col-span-1">
                     <div className="bg-slate-900 dark:bg-[#131b2f] rounded-[2rem] p-8 text-white relative overflow-hidden flex flex-col items-start h-full min-h-[300px]">
                        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                           <Sparkles size={120} />
                        </div>
                        <span className="px-3 py-1 bg-white/10 text-white rounded-full text-[10px] font-bold uppercase tracking-widest mb-auto border border-white/10 backdrop-blur-sm">
                          Seu Progresso
                        </span>
                        
                        <div className="w-full mt-12 z-10">
                          <h3 className="text-5xl font-display font-light leading-tight mb-2 tracking-tight">
                            {completedCount} <span className="text-slate-400 text-2xl font-sans">/ {totalTasks}</span>
                          </h3>
                          <p className="text-slate-400 text-sm mb-8">Tarefas completadas no total.</p>
                          <button onClick={handleNewTaskInit} className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl hover:bg-slate-50 transition-all shadow-xl active:scale-95">
                            Nova Meta
                          </button>
                        </div>
                     </div>
                   </div>
                 </div>

               </motion.div>
             )}

             {activeTab === 'tasks' && (
               <motion.div key="tasks" initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}}>
                 
                 {/* Search & Mobile Filter */}
                 <div className="flex flex-col md:flex-row gap-4 mb-8">
                   <div className="relative flex-1">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                       <input 
                       type="text" placeholder="Buscar tarefas..."
                       value={search} onChange={e => setSearch(e.target.value)}
                       className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                     />
                   </div>
                   
                   <div className="md:hidden flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
                     <FilterTag active={filterCategory === 'Todas'} onClick={() => setFilterCategory('Todas')} label="Todas" />
                     {CATEGORIES.map(cat => (
                       <FilterTag key={cat} active={filterCategory === cat} onClick={() => setFilterCategory(cat)} label={cat} />
                     ))}
                   </div>
                 </div>

                 {/* Tasks List */}
                 <div className="space-y-4">
                   <AnimatePresence>
                     {filteredTasks.length > 0 ? filteredTasks.map(task => (
                       <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} showCompleted={configShowCompleted} />
                     )) : (
                       <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className="text-center py-20 bg-white/30 dark:bg-white/5 border border-slate-200 border-dashed dark:border-white/10 rounded-3xl">
                         <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4 text-slate-400">
                           <Sparkles size={24} />
                         </div>
                         <h3 className="text-lg font-semibold mb-2">Nada por aqui</h3>
                         <p className="text-slate-500 mb-6">Nenhuma tarefa correspondente aos seus filtros.</p>
                         <button onClick={handleNewTaskInit} className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold active:scale-95 transition-transform">
                           Criar Tarefa
                         </button>
                       </motion.div>
                     )}
                   </AnimatePresence>
                 </div>

                 {configShowCompleted && filterCategory === 'Todas' && !search && completedTasks.length > 0 && (
                   <div className="mt-12 opacity-60">
                     <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Concluídas ({completedTasks.length})</h3>
                     <div className="space-y-4">
                       {completedTasks.map(task => (
                         <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} isCompletedSection showCompleted={configShowCompleted} />
                       ))}
                     </div>
                   </div>
                 )}
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </main>

      {/* Slide-In Task Drawer */}
      <AnimatePresence>
        {showTaskForm && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={resetForm}
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: '100%', opacity: 0 }} 
              animate={{ x: 0, opacity: 1 }} 
              exit={{ x: '100%', opacity: 0 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
            >
               <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0 bg-white/50 dark:bg-white/5 backdrop-blur-md">
                  <h2 className="text-xl font-display font-semibold">
                    {editingTaskId ? 'Editar Atividade' : 'Nova Atividade'}
                  </h2>
                  <button onClick={resetForm} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                    <X size={20} />
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-6">
                 <form id="task-form" onSubmit={handleSubmitTask} className="space-y-6">
                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Título da tarefa</label>
                      <input 
                        autoFocus required type="text" placeholder="Ex: Preparar relatório geral"
                        value={formTitle} onChange={e => setFormTitle(e.target.value)}
                        className="w-full text-lg bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      />
                   </div>

                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Prazo e Horário</label>
                      <div className="relative">
                        <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500" size={20} />
                        <input 
                          type="datetime-local" required value={formDate} onChange={e => setFormDate(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none font-sans"
                          style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                        />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Prioridade</label>
                       <select 
                         value={formPriority} onChange={e => setFormPriority(e.target.value as Priority)}
                         className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                       >
                         <option value="low">Baixa</option>
                         <option value="medium">Média</option>
                         <option value="high">Alta</option>
                       </select>
                     </div>
                     <div>
                       <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Categoria</label>
                       <select 
                         value={formCategory} onChange={e => setFormCategory(e.target.value)}
                         className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                       >
                         {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                       </select>
                     </div>
                   </div>

                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Detalhes (Opcional)</label>
                      <textarea 
                        placeholder="Adicione notas, links ou descrições..." value={formDesc} onChange={e => setFormDesc(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 min-h-[140px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                   </div>
                 </form>
               </div>

               <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 bg-white dark:bg-[#040814]">
                 <button form="task-form" type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all">
                   {editingTaskId ? 'Salvar Alterações' : 'Adicionar Tarefa'}
                 </button>
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Profile Form Right Drawer */}
      <AnimatePresence>
        {showProfileForm && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowProfileForm(false)}
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: '100%', opacity: 0 }} 
              animate={{ x: 0, opacity: 1 }} 
              exit={{ x: '100%', opacity: 0 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
            >
               <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0 bg-white/50 dark:bg-white/5 backdrop-blur-md">
                  <h2 className="text-xl font-display font-semibold">Editar Perfil</h2>
                  <button onClick={() => setShowProfileForm(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                    <X size={20} />
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-6">
                 <form id="profile-form" onSubmit={handleUpdateProfile} className="space-y-6">
                   <div className="flex flex-col items-center justify-center mb-6">
                     <div className="relative group rounded-full cursor-pointer">
                       {profAvatar ? (
                         <img src={profAvatar} alt="Foto" className="w-24 h-24 rounded-full object-cover shadow-md border-4 border-white dark:border-[#0a0f1e]" />
                       ) : (
                         <div className="w-24 h-24 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border-4 border-white dark:border-[#0a0f1e]">
                           <UserIcon size={40} />
                         </div>
                       )}
                       <label className="absolute inset-0 bg-black/50 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                         <span className="text-white text-xs font-bold uppercase mt-1">Trocar</span>
                         <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                       </label>
                     </div>
                   </div>

                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Seu Nome</label>
                      <input 
                        required type="text" placeholder="Nome Completo"
                        value={profName} onChange={e => setProfName(e.target.value)}
                        className="w-full text-lg bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      />
                   </div>

                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email</label>
                      <input 
                        required type="email" placeholder="Email"
                        value={profEmail} onChange={e => setProfEmail(e.target.value)}
                        className="w-full text-lg bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      />
                   </div>

                   <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nova Senha (Opcional)</label>
                      <input 
                        type="password" placeholder="Preencha apenas se quiser alterar"
                        value={profPassword} onChange={e => setProfPassword(e.target.value)}
                        className="w-full text-lg bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      />
                   </div>
                 </form>
               </div>

               <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 bg-white dark:bg-[#040814] space-y-3">
                 <button form="profile-form" type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all">
                   Salvar Perfil
                 </button>
                 <button onClick={(e) => { e.preventDefault(); setShowProfileForm(false); handleLogout(); }} type="button" className="w-full md:hidden flex items-center justify-center gap-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-bold py-3.5 rounded-2xl transition-all">
                   <LogOut size={18} />
                   Sair da Conta
                 </button>
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Right Drawer */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: '100%', opacity: 0 }} 
              animate={{ x: 0, opacity: 1 }} 
              exit={{ x: '100%', opacity: 0 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
            >
               <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0 bg-white/50 dark:bg-white/5 backdrop-blur-md">
                  <h2 className="text-xl font-display font-semibold flex items-center gap-2">
                    <Settings size={20} className="text-blue-500" /> Configurações
                  </h2>
                  <button onClick={() => setShowSettings(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                    <X size={20} />
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-6 space-y-8">
                 
                 <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Moon size={14} /> Aparência e Tema
                    </h3>
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                       <span className="font-semibold text-sm">Modo Escuro</span>
                       <button onClick={() => setDarkMode(!darkMode)} className="w-12 h-6 rounded-full bg-slate-200 dark:bg-[#040814] relative transition-colors focus:outline-none border border-slate-300 dark:border-white/10 shadow-inner">
                          <motion.div 
                             animate={{ x: darkMode ? 24 : 2 }} 
                             className="w-5 h-5 rounded-full bg-white shadow-sm flex items-center justify-center top-0 absolute"
                          >
                             {darkMode ? <Moon size={10} className="text-slate-800" /> : <Sun size={10} className="text-amber-500" />}
                          </motion.div>
                       </button>
                    </div>
                 </div>

                 <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <LayoutDashboard size={14} /> Comportamentos
                    </h3>
                    
                    <div className="space-y-2">
                       <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                          <span className="font-semibold text-sm flex items-center gap-2">
                            <Volume2 size={16} className="text-slate-400" /> Efeitos Sonoros
                          </span>
                          <Toggle active={configSound} onClick={() => saveConfig({sound: !configSound})} />
                       </div>

                       <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                          <span className="font-semibold text-sm flex items-center gap-2">
                            <ShieldAlert size={16} className="text-slate-400" /> Confirmar Exclusão
                          </span>
                          <Toggle active={configConfirmDelete} onClick={() => saveConfig({confirmDelete: !configConfirmDelete})} />
                       </div>

                       <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                          <span className="font-semibold text-sm flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-slate-400" /> Exibir Concluídas
                          </span>
                          <Toggle active={configShowCompleted} onClick={() => saveConfig({showCompleted: !configShowCompleted})} />
                       </div>
                    </div>
                 </div>

               </div>
               
               <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 bg-white dark:bg-[#040814]">
                 <p className="text-xs text-center text-slate-400 font-medium">As configurações são salvas automaticamente no seu navegador.</p>
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Global Toast Message */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 md:bottom-8 right-6 z-[200] bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-4 rounded-2xl shadow-2xl flex items-start gap-3 max-w-[320px]"
          >
             <div className="bg-white/20 dark:bg-black/10 text-white dark:text-black p-2 rounded-full shrink-0 flex items-center justify-center">
               <BellRing size={16} />
             </div>
             <div className="flex-1 min-w-0 pr-4">
               <h4 className="font-bold text-sm mb-0.5">{toastMsg.title}</h4>
               <p className="text-xs opacity-90 leading-relaxed font-medium">{toastMsg.message}</p>
             </div>
             <button onClick={() => setToastMsg(null)} className="absolute top-4 right-4 opacity-50 hover:opacity-100">
               <X size={14} />
             </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#040814]/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5 pb-safe">
        <div className="flex items-center justify-around p-2">
          <button onClick={() => setActiveTab('dashboard')} className={cn("flex flex-col items-center p-3 rounded-xl transition-colors", activeTab === 'dashboard' ? "text-blue-600 dark:text-blue-400" : "text-slate-500")}>
            <LayoutDashboard size={24} className={activeTab === 'dashboard' ? "fill-blue-100 dark:fill-blue-900/50" : ""} />
          </button>
          
          <div className="relative -top-6">
            <button onClick={handleNewTaskInit} className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-blue-500/30 active:scale-95 transition-transform border-[6px] border-slate-50 dark:border-[#040814]">
              <Plus size={32} />
            </button>
          </div>

          <button onClick={() => setActiveTab('tasks')} className={cn("flex flex-col items-center p-3 rounded-xl transition-colors relative", activeTab === 'tasks' ? "text-blue-600 dark:text-blue-400" : "text-slate-500")}>
            <ListTodo size={24} className={activeTab === 'tasks' ? "fill-blue-100 dark:fill-blue-900/50" : ""} />
            {pendingTasks.length > 0 && <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white dark:border-[#040814]"></span>}
          </button>
        </div>
      </nav>

    </div>
  );
}

// --- Specialized Components ---

const SidebarItem: React.FC<{ active: boolean, onClick: ()=>void, icon: React.ReactNode, label: string, badge?: number }> = ({ active, onClick, icon, label, badge }) => {
  return (
    <button onClick={onClick} className={cn(
      "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all font-medium outline-none group",
      active ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-200"
    )}>
       <div className="flex items-center gap-3">
         <div className={cn("transition-colors", active ? "text-white dark:text-slate-900" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300")}>
           {icon}
         </div>
         <span>{label}</span>
       </div>
       {!!badge && badge > 0 && (
         <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", active ? "bg-white/20 dark:bg-black/10 text-white dark:text-black" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300")}>{badge}</span>
       )}
    </button>
  );
}

const Toggle: React.FC<{ active: boolean, onClick: ()=>void }> = ({ active, onClick }) => {
  return (
    <button onClick={onClick} className={cn("w-12 h-6 rounded-full relative transition-colors focus:outline-none border shadow-inner", active ? "bg-blue-500 border-blue-600" : "bg-slate-200 dark:bg-[#040814] border-slate-300 dark:border-white/10")}>
       <motion.div 
          animate={{ x: active ? 24 : 2 }} 
          className={cn("w-5 h-5 rounded-full shadow-sm absolute top-0", active ? "bg-white" : "bg-white dark:bg-slate-400")} 
       />
    </button>
  );
}

const FilterTag: React.FC<{ active: boolean, onClick: ()=>void, label: string, count?: number }> = ({ active, onClick, label, count }) => {
  return (
    <button onClick={onClick} className={cn(
      "flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all font-medium text-sm whitespace-nowrap outline-none",
      active 
        ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md" 
        : "bg-slate-100/50 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/10"
    )}>
       <span className="flex items-center gap-2">
         {label !== 'Todas' && <Tag size={14} className={active ? "text-white/70 dark:text-slate-900/70" : "text-slate-400"} />}
         {label}
       </span>
       {count !== undefined && <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", active ? "bg-white/20 dark:bg-black/10" : "bg-slate-200 dark:bg-white/10")}>{count}</span>}
    </button>
  )
}

function MetricCard({ title, value, icon, error }: any) {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-3xl p-5 md:p-6 shadow-sm flex flex-col justify-between overflow-hidden relative">
      <div className="flex items-center justify-between mb-4 z-10">
        <span className="text-slate-500 font-medium text-sm">{title}</span>
        <div className={cn("p-2 rounded-xl", error ? "bg-rose-50 text-rose-500 dark:bg-rose-500/10" : "bg-slate-50 text-slate-400 dark:bg-white/5 dark:text-slate-500")}>
           {icon}
        </div>
      </div>
      <div className="text-4xl font-display font-light z-10">
        {value}
      </div>
      {/* Decorative background shape */}
      <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-slate-900 dark:text-white pointer-events-none">
        {icon}
      </div>
    </div>
  );
}

function TaskItem({ task, onToggle, onDelete, onEdit, compact, isCompletedSection, showCompleted }: any) {
  const isOverdue = isPast(parseISO(task.dueDate)) && !isToday(parseISO(task.dueDate)) && task.status !== 'completed';
  const isCompleted = task.status === 'completed';
  
  if (isCompleted && showCompleted === false) return null;
  
  const priorityColors = {
    low: "text-slate-500 bg-slate-100 dark:bg-white/5 dark:text-slate-400",
    medium: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400",
    high: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400"
  };

  const priorityLabels = { low: 'Baixa', medium: 'Média', high: 'Alta' };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      className={cn(
        "group relative flex items-start gap-4 p-4 md:p-5 rounded-2xl transition-all border",
        isCompleted 
          ? "bg-slate-50 dark:bg-white/[0.01] border-transparent" 
          : "bg-white dark:bg-[#0a0f1e] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:shadow-xl hover:shadow-slate-200/40 dark:hover:shadow-black/40 cursor-pointer"
      )}
      onClick={() => {
        if (!isCompleted && onEdit) onEdit(task);
      }}
    >
      <button 
        onClick={(e) => { e.stopPropagation(); onToggle(task); }}
        className={cn(
          "mt-0.5 shrink-0 transition-colors",
          isCompleted ? "text-emerald-500" : "text-slate-300 hover:text-blue-500 dark:text-slate-600 dark:hover:text-blue-400"
        )}
      >
        {isCompleted ? <CheckCircle2 size={24} /> : <Circle size={24} />}
      </button>
      
      <div className="flex-1 min-w-0">
        <h3 className={cn(
           "font-semibold text-base md:text-lg truncate mb-1 transition-colors", 
           isCompleted ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400"
        )}>
          {task.title}
        </h3>
        
        {!compact && task.description && (
          <p className="text-sm text-slate-500 line-clamp-1 mb-3 pr-8">{task.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-2">
          {!isCompleted && (
            <span className={cn(
              "flex flex-row items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest", 
              priorityColors[task.priority as Priority]
            )}>
              {priorityLabels[task.priority as Priority]}
            </span>
          )}

          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
            <Tag size={10} />
            {task.category || 'Geral'}
          </span>

          <span className={cn("flex flex-row items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest", isOverdue ? "text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10" : "text-slate-500 dark:text-slate-400")}>
            <Clock size={10} />
            {isToday(parseISO(task.dueDate)) ? 'Hoje' : isTomorrow(parseISO(task.dueDate)) ? 'Amanhã' : format(parseISO(task.dueDate), "dd MMM", { locale: ptBR })}
          </span>
        </div>
      </div>

      <button 
        onClick={(e) => onDelete(task.id, e)}
        className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-white/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all absolute right-4 top-4"
        title="Excluir"
      >
        <Trash2 size={16} />
      </button>
    </motion.div>
  );
}
