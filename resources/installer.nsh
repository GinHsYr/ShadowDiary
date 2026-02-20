!include "FileFunc.nsh"

!macro customInit
  ${GetParameters} $R0

  ; Support lowercase /s as a silent install switch for store submission.
  ClearErrors
  ${GetOptions} $R0 "/s" $R1
  IfErrors +2 0
    SetSilent silent
!macroend
