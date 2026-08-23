(async () => {
  const DATA = __IMPORT_DATA__;
  let ok = 0, fail = 0;
  const log = (msg) => console.log('[import]', msg);
  log('เริ่ม import ' + DATA.employees.length + ' พนักงาน...');
  const routeMap = {};
  for (const s of S.shops) routeMap[s.name] = s.id;
  for (const emp of DATA.employees) {
    const route_id = routeMap[emp.route_name] || null;
    if (!route_id) log('⚠️ ไม่พบสาย "' + emp.route_name + '" สำหรับ ' + emp.name);
    try {
      await sbUpsert('employees', { id: emp.id, name: emp.name, route_id, daily_rate: emp.daily_rate, status: emp.status, nationality: emp.nationality, room_fee: emp.room_fee, notes: emp.notes });
      ok++;
      log('✓ ' + emp.name + ' (' + emp.route_name + ')');
    } catch(e) { fail++; log('✗ ' + emp.name + ': ' + e.message); }
  }
  log('พนักงาน: ' + ok + ' สำเร็จ, ' + fail + ' ล้มเหลว');
  log('เริ่ม import ' + DATA.loans.length + ' บัตรใบอนุญาต...');
  ok = 0; fail = 0;
  for (const loan of DATA.loans) {
    try {
      await sbUpsert('employee_loans', loan);
      ok++;
    } catch(e) { fail++; log('✗ loan: ' + e.message); }
  }
  log('loans: ' + ok + ' สำเร็จ, ' + fail + ' ล้มเหลว');
  log('✅ import เสร็จแล้ว — reload หน้าได้เลย');
})();
