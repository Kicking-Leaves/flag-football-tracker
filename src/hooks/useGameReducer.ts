"use client";

// Reducer hook that wraps the pure game-engine functions and persists every
// state change through an injected onSave callback (typically a Supabase
// upsert into games.game_data).

import { useCallback, useEffect, useReducer, useRef } from "react";
import * as engine from "@/lib/game-engine";
import type {
  GameState,
  OTConversionData,
  PenaltyData,
  PlayData,
  PointAfterData,
  Possession,
} from "@/lib/types";

export type GameAction =
  | { type: "ADD_PLAY"; payload: PlayData }
  | { type: "RECORD_POINT_AFTER"; payload: PointAfterData }
  | { type: "RECORD_PENALTY"; payload: PenaltyData }
  | {
      type: "HANDLE_INTERCEPTION";
      payload: { isTD: boolean; fieldPos: number };
    }
  | { type: "END_HALF"; payload: { nextPossession: Possession } }
  | { type: "START_OVERTIME"; payload: { firstOffense: Possession } }
  | { type: "HANDLE_OT_CONVERSION"; payload: OTConversionData }
  | { type: "TRIGGER_OT_SETUP" }
  | { type: "MARK_COMPLETED" }
  | {
      type: "ADJUST_SCORE";
      payload: { team: Possession; amount: number };
    }
  | { type: "UNDO_LAST_PLAY" }
  | { type: "LOAD_GAME"; payload: GameState };

function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "ADD_PLAY":
      return engine.addPlay(state, action.payload);
    case "RECORD_POINT_AFTER":
      return engine.recordPointAfter(state, action.payload);
    case "RECORD_PENALTY":
      return engine.recordPenalty(state, action.payload);
    case "HANDLE_INTERCEPTION":
      return engine.handleInterceptionDetails(
        state,
        action.payload.isTD,
        action.payload.fieldPos,
      );
    case "END_HALF":
      return engine.endHalf(state, action.payload.nextPossession);
    case "START_OVERTIME":
      return engine.startOvertime(state, action.payload.firstOffense);
    case "HANDLE_OT_CONVERSION":
      return engine.handleOvertimeConversion(state, action.payload);
    case "TRIGGER_OT_SETUP":
      return engine.triggerOvertimeSetup(state);
    case "MARK_COMPLETED":
      return engine.markGameCompleted(state);
    case "ADJUST_SCORE":
      return engine.adjustScore(
        state,
        action.payload.team,
        action.payload.amount,
      );
    case "UNDO_LAST_PLAY":
      return engine.undoLastPlay(state);
    case "LOAD_GAME":
      return action.payload;
    default:
      return state;
  }
}

interface UseGameReducerOptions {
  /** Called after every state mutation to persist (e.g. Supabase upsert). */
  onSave?: (state: GameState) => Promise<void> | void;
}

export function useGameReducer(
  initial: GameState,
  options: UseGameReducerOptions = {},
) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Skip the very first save — initial state is whatever was loaded from db.
  const skipFirstSave = useRef(true);
  const onSaveRef = useRef(options.onSave);
  onSaveRef.current = options.onSave;

  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const cb = onSaveRef.current;
    if (cb) {
      void Promise.resolve(cb(state)).catch((err) => {
        console.error("Failed to persist game state:", err);
      });
    }
  }, [state]);

  // Typed convenience methods so consumers don't hand-roll action objects.
  const addPlay = useCallback(
    (payload: PlayData) => dispatch({ type: "ADD_PLAY", payload }),
    [],
  );
  const recordPointAfter = useCallback(
    (payload: PointAfterData) =>
      dispatch({ type: "RECORD_POINT_AFTER", payload }),
    [],
  );
  const recordPenalty = useCallback(
    (payload: PenaltyData) => dispatch({ type: "RECORD_PENALTY", payload }),
    [],
  );
  const handleInterception = useCallback(
    (payload: { isTD: boolean; fieldPos: number }) =>
      dispatch({ type: "HANDLE_INTERCEPTION", payload }),
    [],
  );
  const endHalf = useCallback(
    (nextPossession: Possession) =>
      dispatch({ type: "END_HALF", payload: { nextPossession } }),
    [],
  );
  const startOvertime = useCallback(
    (firstOffense: Possession) =>
      dispatch({ type: "START_OVERTIME", payload: { firstOffense } }),
    [],
  );
  const handleOTConversion = useCallback(
    (payload: OTConversionData) =>
      dispatch({ type: "HANDLE_OT_CONVERSION", payload }),
    [],
  );
  const triggerOTSetup = useCallback(
    () => dispatch({ type: "TRIGGER_OT_SETUP" }),
    [],
  );
  const markCompleted = useCallback(
    () => dispatch({ type: "MARK_COMPLETED" }),
    [],
  );
  const adjustScore = useCallback(
    (team: Possession, amount: number) =>
      dispatch({ type: "ADJUST_SCORE", payload: { team, amount } }),
    [],
  );
  const undoLastPlay = useCallback(
    () => dispatch({ type: "UNDO_LAST_PLAY" }),
    [],
  );
  const loadGame = useCallback(
    (s: GameState) => dispatch({ type: "LOAD_GAME", payload: s }),
    [],
  );

  return {
    state,
    dispatch,
    addPlay,
    recordPointAfter,
    recordPenalty,
    handleInterception,
    endHalf,
    startOvertime,
    handleOTConversion,
    triggerOTSetup,
    markCompleted,
    adjustScore,
    undoLastPlay,
    loadGame,
  };
}
