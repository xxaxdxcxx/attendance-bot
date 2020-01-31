/**
 * Given some user interaction making a change to their attendance status (could
 * be slash command, button click, or modal submit), updates the spreadsheet
 * and sends a response with information about the update.
 * @param context information from user's response
 * @param sheet current sheet
 * @param responseInfo customization for where to send eventual response
 * @param afterSuccessfulChange function called after sheet updated successfully
 */
function handleInOut(
  context: ResponseContext,
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  responseInfo: ResponseCustomization,
  afterSuccessfulChange: Function
): GoogleAppsScript.Content.TextOutput {
  // collect data from slash command
  let username = context.username;
  let dateStr = context.text.split(" ")[0]; // if first word is not date, handled below
  let reason =
    context.text
      .split(" ")
      .slice(1)
      .join(" ") || ""; // every word but first, or empty if 0/1 words
  let userIn = context.command === SlashCommand.in;
  let offset = 0;

  // flags for whether to add various alerts after response
  let spreadsheetUnchanged = false;
  let addLateChangeAlert = false;
  let addPastChangeAlert = false;
  let addNoteAddedAlert = false;
  let addBlackedOutAlert = false;

  console.log(`User ${username}: ${context.command} ${dateStr} ${reason}`);

  // handle date
  let date = new ColumnLocator();
  const parseResult = date.initialize(dateStr);
  if (parseResult === DateParseResult.addToReason) {
    // invalid date; will be added to reason, and date.isValid() is false
    reason = dateStr.length > 0 ? dateStr + " " + reason : reason;
  }

  // ensure user input is valid:
  if (!userIn && reason.length == 0) {
    // trying to /out without a reason SMH
    return sendResponse(FAILURE_RESPONSE + NO_REASON_ERROR, responseInfo);
  }

  // fetch info, update spreadsheet
  let colUpdated: number; // need outside of try/catch scope, for later
  try {
    const row = getUserRow(username, sheet);
    const col = getDateCol(date, sheet);
    const cell = sheet.getRange(row, col);
    if (cell.getBackground() === BLACK_COLOR)
      // cell blacked out
      addBlackedOutAlert = true;
    if (userIn) {
      if (cell.getDisplayValue() === "y" && cell.getNote() === reason)
        spreadsheetUnchanged = true;
      cell.setNote(reason);
      cell.setValue("y");
    } else {
      if (cell.getDisplayValue() === "n" && cell.getNote() === reason)
        spreadsheetUnchanged = true;
      cell.setNote(reason);
      cell.setValue("n");
    }
    console.log(`Success: updated (row ${row}, col ${col})`);
    colUpdated = col;
  } catch (err) {
    console.log("Error updating spreadsheet: ", err);
    return sendResponse(FAILURE_RESPONSE + (err.message || err), responseInfo);
  }

  // check if the update is coming pretty late (after 10pm day before), or for past event
  // fails silently, in case of weird formatted date on attendance spreadsheet who cares
  try {
    const eventDate = getEventInfoFromCol(sheet, colUpdated).eventDate;
    let updateBefore = new Date(eventDate); // assumes date string is m/d/yyyy
    updateBefore.setTime(updateBefore.getTime() - TWO_HOURS); // 10pm the day before
    let nextDay = new Date(eventDate);
    nextDay.setTime(nextDay.getTime() + ONE_DAY); // midnight the next day
    const today = new Date();
    if (!userIn && updateBefore < today) {
      addLateChangeAlert = true;
      console.log("Alerting user about late change");
    }
    if (nextDay < today) addPastChangeAlert = true;
  } catch (err) {
    console.log("Error checking if update came too late: " + err);
  }

  // get data about event from spreadsheet to form response
  let response = makeResponseText(sheet, colUpdated, userIn);
  if (addBlackedOutAlert) response = response + BLACKED_OUT_ALERT;
  if (addLateChangeAlert) response = response + LATE_CHANGE_ALERT;
  if (addPastChangeAlert) response = response + PAST_CHANGE_ALERT;
  if (addNoteAddedAlert) {
    response =
      response +
      '\n:information_source: Added note "' +
      reason +
      '" to your cell';
  }
  afterSuccessfulChange();
  return sendResponse(
    (spreadsheetUnchanged ? NO_CHANGE_RESPONSE : SUCCESS_RESPONSE) + response,
    responseInfo
  );
}
