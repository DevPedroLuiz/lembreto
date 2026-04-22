// src/components/ProfileDrawer.tsx
// Slide-in drawer for editing the user profile

import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Camera, UserIcon as User, LogOut } from 'lucide-react';
import type { User as UserType } from '../types';

// Re-export lucide's UserIcon under a sane name
export { User as UserIcon };

interface ProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onLogout: () => void;

  currentUser: UserType;

  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  avatar: string | null;
  setAvatar: (v: string | null) => void;
}

export function ProfileDrawer({
  open,
  onClose,
  onSubmit,
  onLogout,
  currentUser,
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
  avatar,
  setAvatar,
}: ProfileDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
              <h2 className="text-xl font-semibold">Editar Perfil</h2>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <form id="profile-form" onSubmit={onSubmit} className="space-y-6">
                {/* Avatar picker */}
                <div className="flex justify-center">
                  <div
                    className="relative group cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {avatar ? (
                      <img
                        src={avatar}
                        alt="Avatar"
                        className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-[#040814] shadow-md"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center border-4 border-white dark:border-[#040814]">
                        <User size={36} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera size={20} className="text-white" />
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Nome
                  </label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Nova Senha (Opcional)
                  </label>
                  <input
                    type="password"
                    placeholder="Deixe em branco para manter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 space-y-3">
              <button
                form="profile-form"
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
              >
                Salvar Perfil
              </button>
              <button
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                type="button"
                className="w-full md:hidden flex items-center justify-center gap-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-bold py-3.5 rounded-2xl transition-all"
              >
                <LogOut size={18} /> Sair da Conta
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
