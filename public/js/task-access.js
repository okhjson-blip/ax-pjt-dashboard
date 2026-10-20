(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.DashboardTaskAccess = policy;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const messages = {
    ACCESS_DENIED: '이 항목을 수정할 권한이 없습니다.',
    AUTH_ROLE_INVALID: '로그인 권한을 확인할 수 없습니다. 다시 로그인해 주세요.',
    COMPANY_ACCESS_DENIED: '소속 협력사 정보가 변경되었습니다. 다시 로그인해 주세요.',
    PMO_MEMBERSHIP_CHANGED: '현재 PMO 명단의 이름·이메일이 로그인 정보와 일치하지 않습니다. PMO 등록 정보를 확인해 주세요.',
    PARTICIPANT_LINK_REQUIRED: '본인 참여자 정보가 연결되지 않았습니다. 참여자로 등록한 뒤 다시 로그인해 주세요.',
    PARTICIPANT_NOT_FOUND: '연결된 참여자가 삭제되었거나 이동했습니다. 최신 정보를 불러와 주세요.',
    PARTICIPANT_EMAIL_MISMATCH: '참여자 이메일과 로그인 이메일이 다릅니다. 등록 정보를 확인한 뒤 다시 로그인해 주세요.',
    TASK_COMPANY_MISMATCH: '소속 협력사의 과제만 수정할 수 있습니다. 최신 정보를 불러와 주세요.',
    TASK_OWNER_MISMATCH: '과제 등록자 본인만 수정할 수 있습니다. 과제 참여자·리더 등록만으로는 수정 권한이 부여되지 않습니다.',
    TASK_OWNER_CHANGE_DENIED: '과제 등록자 변경은 관리자만 할 수 있습니다.',
    COMPANY_WRITE_DENIED: '협력사 정보 변경 권한이 없습니다. PMO는 소속 협력사의 공지와 참여자 명단을 관리할 수 있습니다.',
    PARTICIPANT_WRITE_DENIED: '이 참여자 정보의 변경 권한이 없습니다.',
    DB_PERMISSION_DENIED: 'DB에서 저장 권한을 거절했습니다. 최신 정보를 불러온 뒤 다시 시도하고, 계속되면 관리자에게 문의해 주세요.'
  };
  const emailKey = value => String(value || '').trim().toLowerCase();
  const denied = code => ({ allowed: false, code, message: messages[code] || messages.ACCESS_DENIED });
  function taskEditAccess(actor, company, participant) {
    if (!['admin', 'pmo', 'participant'].includes(actor?.role)) return denied('AUTH_ROLE_INVALID');
    if (!participant) return denied('PARTICIPANT_NOT_FOUND');
    if (actor.role === 'admin') return { allowed: true };
    if (!company || company.id !== actor.companyId) return denied('TASK_COMPANY_MISMATCH');
    if (actor.role === 'pmo' && !(company.pmo?.members || []).some(member =>
      String(member.name || '').trim() === String(actor.name || '').trim() && emailKey(member.email) === emailKey(actor.email) && emailKey(actor.email))) {
      return denied('PMO_MEMBERSHIP_CHANGED');
    }
    if (!actor.participantId) return denied('PARTICIPANT_LINK_REQUIRED');
    if (actor.participantId !== participant.id) return denied('TASK_OWNER_MISMATCH');
    if (!emailKey(actor.email) || emailKey(actor.email) !== emailKey(participant.email)) return denied('PARTICIPANT_EMAIL_MISMATCH');
    return { allowed: true };
  }
  return { taskEditAccess, denied, messages };
});
