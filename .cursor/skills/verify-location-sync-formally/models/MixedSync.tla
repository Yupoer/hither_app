---------------------------- MODULE MixedSync ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANT Mutant
Actors == {"A", "B"}
Core == {"c1", "c2", "cb"}
Gps == {"g1", "g2", "gb"}
Events == Core \cup Gps
Owner(e) == IF e \in {"cb", "gb"} THEN "B" ELSE "A"

VARIABLES actor, epoch, queue, phase, batch, batchActor, batchEpoch,
          serverAccepted, reply, observedAcks, removed, projectedWrong, rounds
vars == <<actor, epoch, queue, phase, batch, batchActor, batchEpoch,
          serverAccepted, reply, observedAcks, removed, projectedWrong, rounds>>

Init == /\ actor = "A" /\ epoch = 0 /\ queue = Events
        /\ phase = "idle" /\ batch = {} /\ batchActor = "A" /\ batchEpoch = 0
        /\ serverAccepted = {} /\ reply = {} /\ observedAcks = {}
        /\ removed = {} /\ projectedWrong = FALSE /\ rounds = 0

Prepare == /\ phase = "idle" /\ rounds < 2
           /\ batch' = {e \in queue : Owner(e) = actor}
           /\ batchActor' = actor /\ batchEpoch' = epoch /\ phase' = "prepared"
           /\ UNCHANGED <<actor, epoch, queue, serverAccepted, reply,
                          observedAcks, removed, projectedWrong, rounds>>

SwitchAccount == /\ actor = "A"
                 /\ actor' = "B" /\ epoch' = 1
                 /\ UNCHANGED <<queue, phase, batch, batchActor, batchEpoch,
                                serverAccepted, reply, observedAcks, removed,
                                projectedWrong, rounds>>

Receive == /\ phase = "prepared"
           /\ \E accepted \in SUBSET batch :
                /\ ("c2" \in accepted => "c1" \in accepted \cup serverAccepted)
                /\ serverAccepted' = serverAccepted \cup accepted
                /\ \E ack \in SUBSET accepted :
                     /\ reply' = ack
                     /\ observedAcks' = observedAcks \cup ack
           /\ phase' = "replied"
           /\ UNCHANGED <<actor, epoch, queue, batch, batchActor, batchEpoch,
                          removed, projectedWrong, rounds>>

LoseReply == /\ phase = "prepared"
             /\ \E accepted \in SUBSET batch :
                  /\ ("c2" \in accepted => "c1" \in accepted \cup serverAccepted)
                  /\ serverAccepted' = serverAccepted \cup accepted
             /\ phase' = "idle" /\ rounds' = rounds + 1
             /\ UNCHANGED <<actor, epoch, queue, batch, batchActor, batchEpoch,
                            reply, observedAcks, removed, projectedWrong>>

Settle(kind) ==
    /\ phase = "replied"
    /\ LET acknowledged == IF Mutant = 1 THEN batch ELSE reply
           selected == acknowledged \cap kind
       IN /\ queue' = queue \ selected
          /\ removed' = removed \cup selected
    /\ UNCHANGED <<actor, epoch, phase, batch, batchActor, batchEpoch,
                   serverAccepted, reply, observedAcks, rounds, projectedWrong>>

Publish == /\ phase = "replied"
           /\ ((actor = batchActor /\ epoch = batchEpoch) \/ Mutant = 2)
           /\ projectedWrong' = (projectedWrong \/ actor # batchActor)
           /\ UNCHANGED <<actor, epoch, queue, phase, batch, batchActor,
                          batchEpoch, serverAccepted, reply, observedAcks,
                          removed, rounds>>

Finish == /\ phase = "replied" /\ phase' = "idle" /\ rounds' = rounds + 1
          /\ UNCHANGED <<actor, epoch, queue, batch, batchActor, batchEpoch,
                         serverAccepted, reply, observedAcks, removed, projectedWrong>>

SettleCore == \E e \in Core : Settle({e})
Next == Prepare \/ SwitchAccount \/ Receive \/ LoseReply \/ SettleCore \/ Settle(Gps) \/ Publish \/ Finish
Spec == Init /\ [][Next]_vars
NoUnacknowledgedDeletion == removed \subseteq observedAcks
NoCrossActorProjection == ~projectedWrong
Conservation == queue \cup removed = Events
=============================================================================
