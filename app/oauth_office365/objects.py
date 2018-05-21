class Attachment(object):
    def __init__(self, **kwargs):
        for field in ('contentType', 'isInline', 'name', 'size', 'contentBytes'):
            setattr(self, field, kwargs.get(field, None))

