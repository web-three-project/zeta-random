import React from "react";

export default function AlertModal({ show, title, message, onClose, t }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[380px] max-w-[90vw] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b">
          <div className="text-lg font-bold text-slate-800">{title}</div>
        </div>
        <div className="p-6">
          <p className="text-slate-700 text-sm leading-relaxed">{message}</p>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold"
            >
              {t?.alertConfirm || "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
