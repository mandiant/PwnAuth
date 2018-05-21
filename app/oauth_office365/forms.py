from django.forms import ModelForm
from .models import Application
from django import forms

class ApplicationForm(ModelForm):
    class meta:
        model = Application

    def clean_scopes(self):
        scopes = self.cleaned_data['scopes']
        if not 'user.read' in scopes:
            raise forms.ValidationError("Application scope must include user.read!")

        if not 'offline_access' in scopes:
            raise forms.ValidationError("Application scope must include offline_access")

        return scopes